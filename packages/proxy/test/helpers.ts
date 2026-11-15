/**
 * Test harness: fake clock, scripted upstream fetch, in-memory deps.
 * ALL credentials here are obvious dummies ("dummy-…"); nothing touches the network.
 */
import { ClientAuth, hashClientKey } from "../src/clients.ts";
import { type AccountConfig, parseConfig, type ProxyConfig } from "../src/config.ts";
import type { FetchLike, ProxyDeps } from "../src/deps.ts";
import { AccountPool } from "../src/pool.ts";
import { silentLogger } from "../src/redact.ts";
import { MemoryRecordStore } from "../src/store/records.ts";
import { createUlidFactory } from "../src/util.ts";

export const T0 = Date.parse("2026-11-15T12:00:00.000Z");

export class FakeClock {
  t: number;
  constructor(t = T0) {
    this.t = t;
  }
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

export const DUMMY_PEPPER = "dummy-pepper-for-tests-only-0000";
export const DUMMY_ADMIN = "dummy-admin-token-for-tests-0000";
export const CLIENT_KEY = "bxk-dummy-client-key-all-models";
export const LIMITED_KEY = "bxk-dummy-client-key-sonnet-only";
export const credentialOf = (id: string) => `dummy-upstream-cred-${id}`;

export function account(id: string, over: Partial<AccountConfig> = {}): Record<string, unknown> {
  return { id, provider: "anthropic", label: id, authKind: "api-key", secretId: `secret-${id}`, ...over };
}

export function baseConfig(over: Record<string, unknown> = {}): ProxyConfig {
  return parseConfig({
    listen: { host: "127.0.0.1", port: 8318 },
    secrets: { file: "/nonexistent/secrets.enc", masterKeyFile: "/nonexistent/master-key" },
    records: { sqlitePath: ":memory:" },
    accounts: [account("anthropic-a"), account("anthropic-b"), account("openai-a", { provider: "openai" })],
    clients: [
      { id: "t3-test", label: "T3 test", createdAt: "2026-11-01T00:00:00.000Z", allowedModels: [], migration: "b-net-proxy", keyHash: hashClientKey(CLIENT_KEY, DUMMY_PEPPER) },
      { id: "bot-test", label: "Bot test", createdAt: "2026-11-01T00:00:00.000Z", allowedModels: ["claude-sonnet-*"], migration: "both", keyHash: hashClientKey(LIMITED_KEY, DUMMY_PEPPER) },
    ],
    ...over,
  });
}

export interface UpstreamCall {
  url: string;
  headers: Headers;
  body: string;
  credential: string | null;
}

type Reply = Response | Error | ((call: UpstreamCall) => Response | Promise<Response>);

/** Upstream mock: per-credential queues of replies; records every call. */
export class ScriptedUpstream {
  readonly calls: UpstreamCall[] = [];
  private queues = new Map<string, Reply[]>();
  fallback: Reply | null = null;

  on(accountId: string, ...replies: Reply[]) {
    const k = credentialOf(accountId);
    this.queues.set(k, [...(this.queues.get(k) ?? []), ...replies]);
    return this;
  }

  fetch: FetchLike = async (url, init) => {
    const headers = new Headers(init.headers);
    const credential = headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
    const call: UpstreamCall = { url, headers, body: String(init.body ?? ""), credential };
    this.calls.push(call);
    const q = credential ? this.queues.get(credential) : undefined;
    const r = q?.shift() ?? this.fallback;
    if (!r) throw new Error(`no scripted reply for ${credential}`);
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r(call) : r;
  };

  accountsCalled(): string[] {
    return this.calls.map((c) => (c.credential ?? "").replace("dummy-upstream-cred-", ""));
  }
}

export function makeDeps(opts: { config?: ProxyConfig; clock?: FakeClock; upstream?: ScriptedUpstream } = {}) {
  const clock = opts.clock ?? new FakeClock();
  const config = opts.config ?? baseConfig();
  const upstream = opts.upstream ?? new ScriptedUpstream();
  const store = new MemoryRecordStore();
  const deps: ProxyDeps = {
    config,
    pool: new AccountPool(config.accounts, config.routing, clock),
    store,
    clients: new ClientAuth(config.clients, DUMMY_PEPPER),
    credentials: async (a) => credentialOf(a.id),
    fetch: upstream.fetch,
    clock,
    ids: createUlidFactory(clock),
    logger: silentLogger,
    version: "0.1.0-test",
    startedAt: clock.now(),
    adminToken: DUMMY_ADMIN,
    secrets: {
      listMeta: () => [
        {
          id: "secret-anthropic-a",
          kind: "api-key",
          label: "Anthropic A",
          provider: "anthropic",
          accountId: "anthropic-a",
          storage: "encrypted-file",
          machineId: "bixku-homelab",
          createdAt: "2026-11-01T00:00:00.000Z",
          rotatedAt: null,
          expiresAt: null,
          lastUsedAt: null,
          fingerprint: "0badc0de",
          status: "ok",
        },
      ],
    },
  };
  return { deps, clock, upstream, store, config };
}

export function jsonReply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function sseReply(text: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(chunked(text, 7), { status, headers: { "content-type": "text/event-stream", ...headers } });
}

/** Split text into a byte stream of n-byte chunks (exercises boundary handling). */
export function chunked(text: string, n: number, opts: { failAfter?: number } = {}): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  let sent = 0;
  return new ReadableStream({
    pull(c) {
      if (opts.failAfter !== undefined && sent >= opts.failAfter) {
        c.error(new Error("upstream connection reset (synthetic)"));
        return;
      }
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + n));
      i += n;
      sent++;
    },
  });
}

export function clientRequest(path: string, body: unknown, opts: { key?: string | null; headers?: Record<string, string>; method?: string; signal?: AbortSignal } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.headers };
  const key = opts.key === undefined ? CLIENT_KEY : opts.key;
  if (key) headers.authorization = `Bearer ${key}`;
  return new Request(`http://proxy.test${path}`, {
    method: opts.method ?? "POST",
    headers,
    body: opts.method === "GET" ? undefined : JSON.stringify(body),
    signal: opts.signal,
  });
}
