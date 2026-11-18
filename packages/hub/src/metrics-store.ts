/**
 * Pushed agent metrics + per-machine ingest tokens, in the hub's SQLite file (node:sqlite).
 *
 * Retention: raw samples for 24 h, 5-minute averages for 30 days. Maintenance (roll up the
 * closed 5-minute buckets, then delete expired rows) is driven by ingestion, at most once per
 * bucket, so the hub runs no extra timer and an idle hub does no work. Each pass touches only
 * the buckets closed since the previous pass (cursor in hub_meta), so its cost stays constant.
 *
 * Tokens: only sha256(token) is stored. Tokens are 256-bit random values, so a fast hash is
 * enough (no brute force is possible) and an indexed lookup by hash leaks nothing useful.
 */
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { MachineMetrics, MetricHistory } from "@b-net/core";

export const RAW_RETENTION_SEC = 24 * 3600;
export const ROLLUP_STEP_SEC = 300;
export const ROLLUP_RETENTION_SEC = 30 * 24 * 3600;

/**
 * Every stored MachineMetrics field, in column order. Shared by both tables so the rollup is one
 * SELECT: numbers are averaged (AVG ignores NULLs), the GPU name/count and the WSL flag take MAX.
 */
type Get = (m: MachineMetrics) => number | string | null;
const COLUMNS: ReadonlyArray<{ col: string; type: "REAL" | "TEXT" | "INTEGER"; notNull?: true; agg: "AVG" | "MAX"; get: Get }> = [
  { col: "cpu_pct", type: "REAL", notNull: true, agg: "AVG", get: (m) => m.cpuPct },
  { col: "mem_pct", type: "REAL", notNull: true, agg: "AVG", get: (m) => m.memPct },
  { col: "mem_used_gb", type: "REAL", notNull: true, agg: "AVG", get: (m) => m.memUsedGb },
  { col: "mem_total_gb", type: "REAL", notNull: true, agg: "AVG", get: (m) => m.memTotalGb },
  { col: "disk_pct", type: "REAL", notNull: true, agg: "AVG", get: (m) => m.diskPct },
  { col: "disk_used_gb", type: "REAL", notNull: true, agg: "AVG", get: (m) => m.diskUsedGb },
  { col: "disk_total_gb", type: "REAL", notNull: true, agg: "AVG", get: (m) => m.diskTotalGb },
  { col: "load1", type: "REAL", agg: "AVG", get: (m) => m.load1 },
  { col: "net_rx_bps", type: "REAL", agg: "AVG", get: (m) => m.netRxBps },
  { col: "net_tx_bps", type: "REAL", agg: "AVG", get: (m) => m.netTxBps },
  { col: "uptime_sec", type: "REAL", agg: "AVG", get: (m) => m.uptimeSec },
  { col: "temp_c", type: "REAL", agg: "AVG", get: (m) => m.tempC },
  // gpu_count NULL = no GPU data in that sample (no nvidia-smi, or it failed).
  { col: "gpu_name", type: "TEXT", agg: "MAX", get: (m) => m.gpu?.name ?? null },
  { col: "gpu_count", type: "INTEGER", agg: "MAX", get: (m) => m.gpu?.count ?? null },
  { col: "gpu_util_pct", type: "REAL", agg: "AVG", get: (m) => m.gpu?.utilPct ?? null },
  { col: "gpu_mem_used_mb", type: "REAL", agg: "AVG", get: (m) => m.gpu?.memUsedMb ?? null },
  { col: "gpu_mem_total_mb", type: "REAL", agg: "AVG", get: (m) => m.gpu?.memTotalMb ?? null },
  { col: "gpu_temp_c", type: "REAL", agg: "AVG", get: (m) => m.gpu?.tempC ?? null },
  { col: "wsl_vm", type: "INTEGER", agg: "MAX", get: (m) => (m.wslVm ? 1 : null) },
];

const COLS = COLUMNS.map((c) => c.col);
const colDefs = COLUMNS.map((c) => `${c.col} ${c.type}${c.notNull ? " NOT NULL" : ""}`).join(", ");
const aggExprs = COLUMNS.map((c) => `${c.agg}(${c.col})`).join(", ");

export function hashAgentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 32 random bytes, base64url, with a prefix so a leaked token is recognisable in logs/scanners. */
export function generateAgentToken(): string {
  return `bnet_agent_${randomBytes(32).toString("base64url")}`;
}

export interface StoredSample {
  /** Unix seconds (hub clock). */
  ts: number;
  metrics: MachineMetrics;
}

export interface RollupPoint {
  bucket: number;
  samples: number;
  metrics: MachineMetrics;
}

type Row = Record<string, number | string | null>;

const num = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

function rowToMetrics(r: Row): MachineMetrics {
  const m: MachineMetrics = {
    cpuPct: num(r.cpu_pct)!,
    memPct: num(r.mem_pct)!,
    memUsedGb: num(r.mem_used_gb)!,
    memTotalGb: num(r.mem_total_gb)!,
    diskPct: num(r.disk_pct)!,
    diskUsedGb: num(r.disk_used_gb)!,
    diskTotalGb: num(r.disk_total_gb)!,
    load1: num(r.load1),
    netRxBps: num(r.net_rx_bps),
    netTxBps: num(r.net_tx_bps),
    uptimeSec: num(r.uptime_sec),
    tempC: num(r.temp_c),
  };
  // Optional keys only when present, so samples without GPU/WSL read back exactly as pushed.
  if (r.gpu_count !== null && r.gpu_count !== undefined) {
    m.gpu = {
      name: String(r.gpu_name ?? ""),
      count: Number(r.gpu_count),
      utilPct: num(r.gpu_util_pct),
      memUsedMb: num(r.gpu_mem_used_mb),
      memTotalMb: num(r.gpu_mem_total_mb),
      tempC: num(r.gpu_temp_c),
    };
  }
  if (num(r.wsl_vm) === 1) m.wslVm = true;
  return m;
}

export class SqliteMetricsStore {
  private readonly db: DatabaseSync;
  private nextMaintenanceAt = 0;

  /** path ":memory:" for tests. May be the same file as SqliteUsageStore (separate connection, WAL). */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS agent_tokens (
        token_hash TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS metrics_raw (
        machine_id TEXT NOT NULL, ts INTEGER NOT NULL, ${colDefs},
        PRIMARY KEY (machine_id, ts)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS metrics_raw_ts ON metrics_raw(ts);
      CREATE TABLE IF NOT EXISTS metrics_5m (
        machine_id TEXT NOT NULL, bucket INTEGER NOT NULL, samples INTEGER NOT NULL, ${colDefs},
        PRIMARY KEY (machine_id, bucket)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS metrics_5m_bucket ON metrics_5m(bucket);
      CREATE TABLE IF NOT EXISTS hub_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  /* ---------------- tokens ---------------- */

  /** Issues (or rotates) the token of a machine. Returns the plaintext token; only its hash is kept. */
  issueToken(machineId: string, now: Date = new Date()): string {
    const token = generateAgentToken();
    this.db
      .prepare(
        `INSERT INTO agent_tokens (token_hash, machine_id, created_at) VALUES (?, ?, ?)
         ON CONFLICT(machine_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`,
      )
      .run(hashAgentToken(token), machineId, now.toISOString());
    return token;
  }

  revokeToken(machineId: string): boolean {
    return Number(this.db.prepare("DELETE FROM agent_tokens WHERE machine_id = ?").run(machineId).changes) > 0;
  }

  /** Machine id the token belongs to, or null. */
  machineForToken(token: string): string | null {
    const row = this.db.prepare("SELECT machine_id FROM agent_tokens WHERE token_hash = ?").get(hashAgentToken(token)) as
      | { machine_id: string }
      | undefined;
    return row?.machine_id ?? null;
  }

  listTokens(): Array<{ machineId: string; createdAt: string }> {
    return (this.db.prepare("SELECT machine_id, created_at FROM agent_tokens ORDER BY machine_id").all() as Array<{ machine_id: string; created_at: string }>).map(
      (r) => ({ machineId: r.machine_id, createdAt: r.created_at }),
    );
  }

  /* ---------------- samples ---------------- */

  /** Stores one sample at `tsSec` (hub clock). A second sample in the same second replaces the first. */
  insert(machineId: string, tsSec: number, m: MachineMetrics): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO metrics_raw (machine_id, ts, ${COLS.join(", ")}) VALUES (?, ?, ${COLS.map(() => "?").join(", ")})`)
      .run(machineId, tsSec, ...COLUMNS.map((c) => c.get(m)));
    if (tsSec >= this.nextMaintenanceAt) this.maintain(tsSec);
  }

  /** Raw samples of one machine with ts >= sinceSec, oldest first. */
  recent(machineId: string, sinceSec: number): StoredSample[] {
    const rows = this.db
      .prepare(`SELECT ts, ${COLS.join(", ")} FROM metrics_raw WHERE machine_id = ? AND ts >= ? ORDER BY ts`)
      .all(machineId, sinceSec) as Row[];
    return rows.map((r) => ({ ts: Number(r.ts), metrics: rowToMetrics(r) }));
  }

  rollups(machineId: string, sinceSec: number): RollupPoint[] {
    const rows = this.db
      .prepare(`SELECT bucket, samples, ${COLS.join(", ")} FROM metrics_5m WHERE machine_id = ? AND bucket >= ? ORDER BY bucket`)
      .all(machineId, sinceSec) as Row[];
    return rows.map((r) => ({ bucket: Number(r.bucket), samples: Number(r.samples), metrics: rowToMetrics(r) }));
  }

  /**
   * Rolls every closed 5-minute bucket since the last pass into metrics_5m (AVG ignores NULLs),
   * then deletes raw rows older than 24 h (never one not yet rolled up) and rollups older than
   * 30 days. Idempotent.
   */
  maintain(nowSec: number): void {
    const closedUntil = Math.floor(nowSec / ROLLUP_STEP_SEC) * ROLLUP_STEP_SEC;
    const cursorRow = this.db.prepare("SELECT value FROM hub_meta WHERE key = 'metrics_rollup_until'").get() as { value: string } | undefined;
    // Raw rows are only deleted once rolled up (see the DELETE below), so the cursor alone is a safe start.
    const from = cursorRow ? Number(cursorRow.value) : 0;
    this.db.exec("BEGIN");
    try {
      if (closedUntil > from) {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO metrics_5m (machine_id, bucket, samples, ${COLS.join(", ")})
             SELECT machine_id, (ts / ${ROLLUP_STEP_SEC}) * ${ROLLUP_STEP_SEC} AS b, COUNT(*), ${aggExprs}
             FROM metrics_raw WHERE ts >= ? AND ts < ? GROUP BY machine_id, b`,
          )
          .run(from, closedUntil);
        this.db
          .prepare("INSERT INTO hub_meta (key, value) VALUES ('metrics_rollup_until', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
          .run(String(closedUntil));
      }
      // min(): a sample in a bucket that is still open is kept even past 24 h (only after a long gap).
      this.db.prepare("DELETE FROM metrics_raw WHERE ts < ?").run(Math.min(nowSec - RAW_RETENTION_SEC, closedUntil));
      this.db.prepare("DELETE FROM metrics_5m WHERE bucket < ?").run(nowSec - ROLLUP_RETENTION_SEC);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.nextMaintenanceAt = closedUntil + ROLLUP_STEP_SEC;
  }

  counts(): { raw: number; rollups: number } {
    const n = (t: string) => Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
    return { raw: n("metrics_raw"), rollups: n("metrics_5m") };
  }

  close(): void {
    this.db.close();
  }
}

/** Short cpu/mem history for sparklines from raw samples (oldest first). */
export function historyFrom(samples: StoredSample[], stepSec: number): MetricHistory | null {
  if (samples.length === 0) return null;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { stepSec, cpuPct: samples.map((s) => r1(s.metrics.cpuPct)), memPct: samples.map((s) => r1(s.metrics.memPct)) };
}
