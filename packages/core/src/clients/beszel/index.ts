/**
 * Typed, read-only client for a Beszel hub (PocketBase backend).
 *
 * Field names of `systems.info` and `system_stats.stats` are abbreviated in Beszel
 * and were INFERRED from the public Beszel source (internal/entities/system). They are
 * parsed tolerantly (loose objects, every field optional) — see docs/notes/hub.md for
 * the list of fields still to be verified against a real instance.
 *
 * Security: the auth token lives only inside the client closure. It is never logged,
 * never included in error messages and never returned.
 */
import { z } from "zod";
import type { MachineMetrics, MetricHistory } from "../../contracts/machines.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/* ------------------------------------------------------------------ *
 * Raw response schemas
 * ------------------------------------------------------------------ */

const num = z.number().finite();

export const BeszelAuthResponse = z.looseObject({
  token: z.string().min(1),
  record: z.looseObject({ id: z.string() }),
});

/** PocketBase list envelope. */
export const pocketbasePage = <T extends z.ZodType>(item: T) =>
  z.looseObject({
    page: z.number().int(),
    perPage: z.number().int(),
    totalItems: z.number().int(),
    totalPages: z.number().int(),
    items: z.array(item),
  });

/**
 * systems.info. Abbreviations (inferred):
 *  h hostname · k kernel · c cores · t threads · m cpu model · u uptime (s) ·
 *  cpu cpu % · mp mem % · dp disk % · b bandwidth (MB/s) · v agent version ·
 *  la load avg [1,5,15] (newer agents) · l1/l5/l15 load (older agents) · dt dashboard temp (°C) · os
 */
export const BeszelSystemInfo = z.looseObject({
  h: z.string().optional(),
  k: z.string().optional(),
  c: num.optional(),
  t: num.optional(),
  m: z.string().optional(),
  u: num.optional(),
  cpu: num.optional(),
  mp: num.optional(),
  dp: num.optional(),
  b: num.optional(),
  v: z.string().optional(),
  la: z.array(num).optional(),
  l1: num.optional(),
  dt: num.optional(),
});
export type BeszelSystemInfo = z.infer<typeof BeszelSystemInfo>;

export const BeszelSystemRecord = z.looseObject({
  id: z.string(),
  name: z.string(),
  host: z.string().optional(),
  /** "up" | "down" | "paused" | "pending" in current Beszel; kept as string for tolerance. */
  status: z.string(),
  info: BeszelSystemInfo.nullish(),
  updated: z.string().optional(),
});
export type BeszelSystemRecord = z.infer<typeof BeszelSystemRecord>;

/**
 * system_stats.stats. Abbreviations (inferred):
 *  cpu % · m mem total (GB) · mu mem used (GB) · mp mem % · d disk total (GB) · du disk used (GB) ·
 *  dp disk % · ns net sent (MB/s) · nr net recv (MB/s) · t temperatures {sensor: °C} · la load avg
 */
export const BeszelStats = z.looseObject({
  cpu: num.optional(),
  m: num.optional(),
  mu: num.optional(),
  mp: num.optional(),
  d: num.optional(),
  du: num.optional(),
  dp: num.optional(),
  ns: num.optional(),
  nr: num.optional(),
  t: z.record(z.string(), num).nullish(),
  la: z.array(num).optional(),
});
export type BeszelStats = z.infer<typeof BeszelStats>;

export const BeszelStatsRecord = z.looseObject({
  id: z.string(),
  system: z.string(),
  type: z.string().optional(), // "1m", "10m", ...
  stats: BeszelStats,
  created: z.string(),
});
export type BeszelStatsRecord = z.infer<typeof BeszelStatsRecord>;

/* ------------------------------------------------------------------ *
 * Mapping to shared contracts
 * ------------------------------------------------------------------ */

/** Beszel's MB/s unit is treated as MiB/s (1024*1024). Unverified, see notes. */
const MB = 1024 * 1024;
const clampPct = (v: number | undefined) => (v === undefined ? 0 : Math.max(0, Math.min(100, round1(v))));
const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const nonNeg = (v: number | undefined) => (v === undefined ? 0 : Math.max(0, round2(v)));

/** PocketBase timestamps look like "2026-11-15 20:29:00.123Z" (space separator). */
export function pocketbaseTimeToIso(s: string | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function mapBeszelMetrics(system: BeszelSystemRecord, latest: BeszelStatsRecord | undefined): MachineMetrics | null {
  const info = system.info ?? {};
  const s = latest?.stats;
  if (!s && info.cpu === undefined && info.mp === undefined) return null;
  const temps = s?.t ? Object.values(s.t) : [];
  const load = s?.la?.[0] ?? info.la?.[0] ?? info.l1;
  return {
    cpuPct: clampPct(s?.cpu ?? info.cpu),
    memPct: clampPct(s?.mp ?? info.mp),
    memUsedGb: nonNeg(s?.mu),
    memTotalGb: nonNeg(s?.m),
    diskPct: clampPct(s?.dp ?? info.dp),
    diskUsedGb: nonNeg(s?.du),
    diskTotalGb: nonNeg(s?.d),
    load1: load === undefined ? null : Math.max(0, load),
    netRxBps: s?.nr === undefined ? null : Math.round(Math.max(0, s.nr) * MB),
    netTxBps: s?.ns === undefined ? null : Math.round(Math.max(0, s.ns) * MB),
    uptimeSec: info.u === undefined ? null : Math.max(0, Math.round(info.u)),
    tempC: temps.length ? Math.max(...temps) : (info.dt ?? null),
  };
}

/** Build a sparkline history from stats records (any order). */
export function mapBeszelHistory(records: BeszelStatsRecord[], stepSec = 60): MetricHistory | null {
  if (records.length < 2) return null;
  const sorted = [...records].sort((a, b) => Date.parse(pocketbaseTimeToIso(a.created) ?? "0") - Date.parse(pocketbaseTimeToIso(b.created) ?? "0"));
  return {
    stepSec,
    cpuPct: sorted.map((r) => clampPct(r.stats.cpu)),
    memPct: sorted.map((r) => clampPct(r.stats.mp)),
  };
}

export interface BeszelMachine {
  systemId: string;
  name: string;
  status: string;
  metrics: MachineMetrics | null;
  metricsAt: string | null;
  history: MetricHistory | null;
}

export function mapBeszelMachine(system: BeszelSystemRecord, stats: BeszelStatsRecord[]): BeszelMachine {
  const sorted = [...stats].sort((a, b) => (pocketbaseTimeToIso(b.created) ?? "").localeCompare(pocketbaseTimeToIso(a.created) ?? ""));
  const latest = sorted[0];
  return {
    systemId: system.id,
    name: system.name,
    status: system.status,
    metrics: mapBeszelMetrics(system, latest),
    metricsAt: pocketbaseTimeToIso(latest?.created) ?? pocketbaseTimeToIso(system.updated),
    history: mapBeszelHistory(sorted),
  };
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

export class BeszelError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "BeszelError";
    this.status = status;
  }
}

export interface BeszelClientOptions {
  baseUrl: string;
  email: string;
  password: string;
  fetch: FetchLike;
  /** Auth collection. Beszel users live in "users". */
  collection?: string;
  /** Number of 1m stats records per system used for history (default 30). */
  historyPoints?: number;
}

export interface BeszelClient {
  listSystems(): Promise<BeszelSystemRecord[]>;
  latestStats(systemId: string, limit?: number): Promise<BeszelStatsRecord[]>;
  /** systems + latest stats, mapped. */
  fetchMachines(): Promise<BeszelMachine[]>;
}

export function createBeszelClient(opts: BeszelClientOptions): BeszelClient {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const collection = opts.collection ?? "users";
  const historyPoints = opts.historyPoints ?? 30;
  let token: string | null = null;

  async function authenticate(): Promise<string> {
    const res = await opts.fetch(`${base}/api/collections/${encodeURIComponent(collection)}/auth-with-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ identity: opts.email, password: opts.password }),
    });
    if (!res.ok) throw new BeszelError(`beszel auth failed: HTTP ${res.status}`, res.status);
    const parsed = BeszelAuthResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new BeszelError("beszel auth: unexpected response shape");
    token = parsed.data.token;
    return token;
  }

  async function getJson(path: string, retried = false): Promise<unknown> {
    const t = token ?? (await authenticate());
    const res = await opts.fetch(`${base}${path}`, { headers: { authorization: t, accept: "application/json" } });
    if ((res.status === 401 || res.status === 403) && !retried) {
      token = null;
      return getJson(path, true);
    }
    if (!res.ok) throw new BeszelError(`beszel GET ${path.split("?")[0]}: HTTP ${res.status}`, res.status);
    return res.json();
  }

  const SystemsPage = pocketbasePage(BeszelSystemRecord);
  const StatsPage = pocketbasePage(BeszelStatsRecord);

  async function listSystems(): Promise<BeszelSystemRecord[]> {
    const out: BeszelSystemRecord[] = [];
    for (let page = 1; page <= 50; page++) {
      const parsed = SystemsPage.safeParse(await getJson(`/api/collections/systems/records?page=${page}&perPage=200&sort=name`));
      if (!parsed.success) throw new BeszelError("beszel systems: unexpected response shape");
      out.push(...parsed.data.items);
      if (page >= parsed.data.totalPages) break;
    }
    return out;
  }

  async function latestStats(systemId: string, limit = historyPoints): Promise<BeszelStatsRecord[]> {
    const filter = encodeURIComponent(`system='${systemId.replace(/'/g, "")}' && type='1m'`);
    const parsed = StatsPage.safeParse(
      await getJson(`/api/collections/system_stats/records?page=1&perPage=${limit}&sort=-created&filter=${filter}&skipTotal=1`),
    );
    if (!parsed.success) throw new BeszelError("beszel system_stats: unexpected response shape");
    return parsed.data.items;
  }

  async function fetchMachines(): Promise<BeszelMachine[]> {
    const systems = await listSystems();
    return Promise.all(systems.map(async (s) => mapBeszelMachine(s, await latestStats(s.id))));
  }

  return { listSystems, latestStats, fetchMachines };
}
