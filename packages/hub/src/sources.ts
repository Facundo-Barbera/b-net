/**
 * Fetchers for the HTTP sources (agents and proxy) + Tailscale cycle. All I/O is injected.
 * Every response is validated with the shared zod contracts; invalid payloads count as failures.
 */
import { z } from "zod";
import {
  AccountView, AgentMetrics, AgentRoutes, AgentThreads, ProxyInternalRoutes, ProxyStatus, SecretMeta, UsageRecordsPage,
  type MachineConfig,
} from "@bixku/core";
import { firstIPv4, indexByHostName, type PingOutcome, type TailscaleSource, type TailscaleStatus } from "@bixku/core/clients/tailscale";
import type { UsageStore } from "./store.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

export async function getJson<T>(
  fetch: FetchLike,
  url: string,
  schema: z.ZodType<T>,
  opts: { token?: string | null; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const path = new URL(url).pathname;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 5000) });
  if (!res.ok) throw new SourceError(`GET ${path}: HTTP ${res.status}`);
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) throw new SourceError(`GET ${path}: invalid payload at ${parsed.error.issues[0]?.path.join(".") || "(root)"}`);
  return parsed.data;
}

/* ---------------- agents ---------------- */

export const fetchAgentMetrics = (fetch: FetchLike, baseUrl: string, token: string | null) =>
  getJson(fetch, `${baseUrl}${AgentRoutes.metrics}`, AgentMetrics, { token });

export const fetchAgentThreads = (fetch: FetchLike, baseUrl: string, token: string | null) =>
  getJson(fetch, `${baseUrl}${AgentRoutes.t3Threads}`, AgentThreads, { token }).then((r) => r.threads);

/* ---------------- proxy ---------------- */

const AccountsBody = z.object({ accounts: z.array(AccountView) });

/**
 * Secrets are re-projected onto SecretMeta's known keys BEFORE validation, so an upstream that
 * (wrongly) added a value-like field can never get it through to the UI. Invalid entries are dropped.
 */
const SECRET_KEYS = Object.keys(SecretMeta.shape) as (keyof SecretMeta)[];
export function projectSecrets(raw: unknown): SecretMeta[] {
  const list = (raw as { secrets?: unknown })?.secrets;
  if (!Array.isArray(list)) throw new SourceError("secrets: invalid payload");
  const out: SecretMeta[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const picked = Object.fromEntries(SECRET_KEYS.filter((k) => k in item).map((k) => [k, (item as Record<string, unknown>)[k]]));
    const r = SecretMeta.safeParse(picked);
    if (r.success) out.push(r.data);
  }
  return out;
}

export async function fetchProxy(fetch: FetchLike, baseUrl: string, token: string | null) {
  const [status, accounts, secrets] = await Promise.all([
    getJson(fetch, `${baseUrl}${ProxyInternalRoutes.status}`, ProxyStatus, { token }),
    getJson(fetch, `${baseUrl}${ProxyInternalRoutes.accounts}`, AccountsBody, { token }).then((b) => b.accounts),
    getJson(fetch, `${baseUrl}${ProxyInternalRoutes.secrets}`, z.unknown(), { token }).then(projectSecrets),
  ]);
  return { status, accounts, secrets };
}

/**
 * Pull usage records from the proxy starting at the store cursor until caught up
 * (or maxPages). The cursor advances only after a page is stored.
 */
export async function ingestUsage(
  fetch: FetchLike,
  baseUrl: string,
  token: string | null,
  store: UsageStore,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<{ added: number; pages: number; cursor: string | null }> {
  const pageSize = opts.pageSize ?? 500;
  const maxPages = opts.maxPages ?? 20;
  let added = 0;
  let pages = 0;
  for (; pages < maxPages; ) {
    const cursor = store.getCursor();
    const q = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) q.set("since", cursor);
    const page = await getJson(fetch, `${baseUrl}${ProxyInternalRoutes.records}?${q}`, UsageRecordsPage, { token });
    pages++;
    added += store.append(page.records);
    const last = page.records.at(-1)?.id ?? null;
    const next = page.nextCursor ?? last;
    if (next && next !== cursor) store.setCursor(next);
    if (!page.nextCursor || page.records.length === 0) break;
  }
  return { added, pages, cursor: store.getCursor() };
}

/* ---------------- tailscale ---------------- */

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** One Tailscale cycle: status + one ping per configured, online, non-self peer. */
export async function pollTailscale(
  src: TailscaleSource,
  machines: MachineConfig[],
  opts: { concurrency?: number; pingTimeoutMs?: number } = {},
): Promise<{ status: TailscaleStatus; pings: Record<string, PingOutcome> }> {
  const status = await src.status();
  const idx = indexByHostName(status);
  const targets = machines.flatMap((m) => {
    const e = idx.get(m.tailscaleHost.toLowerCase());
    const ip = e ? firstIPv4(e.peer.TailscaleIPs) : null;
    return e && !e.isSelf && e.peer.Online && ip ? [{ id: m.id, ip }] : [];
  });
  const results = await mapLimit(targets, opts.concurrency ?? 4, async (t) => {
    try {
      return [t.id, await src.ping(t.ip, { timeoutMs: opts.pingTimeoutMs ?? 3000 })] as const;
    } catch (e) {
      return [t.id, { ok: false, latencyMs: null, path: "unknown", relay: null, error: (e as Error).message }] as const;
    }
  });
  return { status, pings: Object.fromEntries(results) };
}
