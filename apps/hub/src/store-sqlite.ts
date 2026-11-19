/**
 * node:sqlite implementation of UsageStore (Node >= 22.13, no native deps).
 * Rows keep the full record as JSON plus indexed columns for cursor/account queries.
 */
import { DatabaseSync } from "node:sqlite";
import { UsageRecord, type UsageRecordsPage } from "@fhub/core";
import { MAX_PAGE, type ListQuery, type UsageStore } from "./store.ts";

export class SqliteUsageStore implements UsageStore {
  private readonly db: DatabaseSync;

  /** path ":memory:" for tests. */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS usage_records (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        account_id TEXT NOT NULL,
        json TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS usage_records_account ON usage_records(account_id, id);
      CREATE TABLE IF NOT EXISTS hub_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  append(records: UsageRecord[]): number {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO usage_records (id, ts, account_id, json) VALUES (?, ?, ?, ?)");
    let added = 0;
    this.db.exec("BEGIN");
    try {
      for (const r of records) added += Number(stmt.run(r.id, r.ts, r.accountId, JSON.stringify(r)).changes);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return added;
  }

  list(q: ListQuery): UsageRecordsPage {
    const limit = Math.max(1, Math.min(q.limit, MAX_PAGE));
    const rows = this.db
      .prepare("SELECT json FROM usage_records WHERE id > ? AND (? IS NULL OR account_id = ?) ORDER BY id LIMIT ?")
      .all(q.since ?? "", q.accountId ?? null, q.accountId ?? null, limit + 1) as { json: string }[];
    const records = rows.slice(0, limit).map((r) => UsageRecord.parse(JSON.parse(r.json)));
    return { records, nextCursor: rows.length > limit ? records.at(-1)!.id : null };
  }

  getCursor(): string | null {
    const row = this.db.prepare("SELECT value FROM hub_meta WHERE key = 'usage_cursor'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  setCursor(cursor: string): void {
    this.db.prepare("INSERT INTO hub_meta (key, value) VALUES ('usage_cursor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(cursor);
  }

  count(): number {
    return Number((this.db.prepare("SELECT COUNT(*) AS n FROM usage_records").get() as { n: number }).n);
  }

  close(): void {
    this.db.close();
  }
}
