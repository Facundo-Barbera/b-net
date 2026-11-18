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

/** Every MachineMetrics field, in column order. Shared by both tables so the rollup is one SELECT. */
const FIELDS = [
  ["cpu_pct", "cpuPct"],
  ["mem_pct", "memPct"],
  ["mem_used_gb", "memUsedGb"],
  ["mem_total_gb", "memTotalGb"],
  ["disk_pct", "diskPct"],
  ["disk_used_gb", "diskUsedGb"],
  ["disk_total_gb", "diskTotalGb"],
  ["load1", "load1"],
  ["net_rx_bps", "netRxBps"],
  ["net_tx_bps", "netTxBps"],
  ["uptime_sec", "uptimeSec"],
  ["temp_c", "tempC"],
] as const satisfies ReadonlyArray<readonly [string, keyof MachineMetrics]>;

const COLS = FIELDS.map(([c]) => c);
const NULLABLE = new Set<string>(["load1", "net_rx_bps", "net_tx_bps", "uptime_sec", "temp_c"]);
const colDefs = COLS.map((c) => `${c} REAL${NULLABLE.has(c) ? "" : " NOT NULL"}`).join(", ");

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

type Row = Record<string, number | null>;

function rowToMetrics(r: Row): MachineMetrics {
  const m: Record<string, number | null> = {};
  for (const [col, key] of FIELDS) {
    const v = r[col] ?? null;
    m[key] = v === null ? null : Number(v);
  }
  return m as unknown as MachineMetrics;
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
      .run(machineId, tsSec, ...FIELDS.map(([, k]) => m[k]));
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
             SELECT machine_id, (ts / ${ROLLUP_STEP_SEC}) * ${ROLLUP_STEP_SEC} AS b, COUNT(*), ${COLS.map((c) => `AVG(${c})`).join(", ")}
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
