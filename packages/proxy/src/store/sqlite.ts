/**
 * SQLite RecordStore (node:sqlite, synchronous). Append-only is enforced by
 * triggers that abort any UPDATE or DELETE. Retention/pruning is an open
 * question (docs/notes/proxy.md) and would need an explicit migration.
 *
 * Kept in its own module because importing node:sqlite prints an
 * ExperimentalWarning on Node 22; only serve.ts and its test import it.
 */
import { DatabaseSync } from "node:sqlite";
import type { UsageRecord, UsageRecordsPage, UsageTotals } from "@bixku/core";
import type { RecordStore, TotalsFilter } from "./records.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  ts_ms INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_usd REAL,
  json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS usage_records_ts ON usage_records(ts_ms);
CREATE INDEX IF NOT EXISTS usage_records_account_ts ON usage_records(account_id, ts_ms);
CREATE TRIGGER IF NOT EXISTS usage_records_no_update BEFORE UPDATE ON usage_records
  BEGIN SELECT RAISE(ABORT, 'usage_records is append-only'); END;
CREATE TRIGGER IF NOT EXISTS usage_records_no_delete BEFORE DELETE ON usage_records
  BEGIN SELECT RAISE(ABORT, 'usage_records is append-only'); END;
`;

export class SqliteRecordStore implements RecordStore {
  private readonly db: DatabaseSync;
  private readonly ins;
  private readonly pageFirst;
  private readonly pageSince;
  private readonly recentQ;
  private readonly sinceQ;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
    this.ins = this.db.prepare(
      `INSERT INTO usage_records (id, ts_ms, account_id, client_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.pageFirst = this.db.prepare("SELECT json FROM usage_records ORDER BY id LIMIT ?");
    this.pageSince = this.db.prepare("SELECT json FROM usage_records WHERE id > ? ORDER BY id LIMIT ?");
    this.recentQ = this.db.prepare("SELECT json FROM usage_records ORDER BY id DESC LIMIT ?");
    this.sinceQ = this.db.prepare("SELECT json FROM usage_records WHERE ts_ms >= ? ORDER BY id");
  }

  append(r: UsageRecord) {
    this.ins.run(r.id, Date.parse(r.ts), r.accountId, r.clientId, r.inputTokens, r.outputTokens, r.cacheReadTokens, r.cacheWriteTokens, r.costUsd, JSON.stringify(r));
  }

  private rows(rows: unknown[]): UsageRecord[] {
    return rows.map((row) => JSON.parse((row as { json: string }).json) as UsageRecord);
  }

  page(since: string | null, limit: number): UsageRecordsPage {
    const records = this.rows(since ? this.pageSince.all(since, limit) : this.pageFirst.all(limit));
    return { records, nextCursor: records.length === limit && records.length > 0 ? records[records.length - 1]!.id : null };
  }

  recent(limit: number) {
    return this.rows(this.recentQ.all(limit));
  }

  sinceTs(fromMs: number) {
    return this.rows(this.sinceQ.all(fromMs));
  }

  totals(f: TotalsFilter): UsageTotals {
    const where = ["ts_ms >= ?"];
    const args: Array<string | number> = [f.fromMs];
    if (f.toMs !== undefined) {
      where.push("ts_ms < ?");
      args.push(f.toMs);
    }
    if (f.accountId) {
      where.push("account_id = ?");
      args.push(f.accountId);
    }
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o,
                COALESCE(SUM(cache_read_tokens),0) AS cr, COALESCE(SUM(cache_write_tokens),0) AS cw, COALESCE(SUM(cost_usd),0) AS c
         FROM usage_records WHERE ${where.join(" AND ")}`,
      )
      .get(...args) as { requests: number; i: number; o: number; cr: number; cw: number; c: number };
    return {
      requests: Number(row.requests),
      inputTokens: Number(row.i),
      outputTokens: Number(row.o),
      cacheReadTokens: Number(row.cr),
      cacheWriteTokens: Number(row.cw),
      costUsd: Math.round(Number(row.c) * 1e6) / 1e6,
    };
  }

  close() {
    this.db.close();
  }
}
