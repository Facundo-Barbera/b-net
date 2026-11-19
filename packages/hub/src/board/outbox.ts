/**
 * Durable webhook outbox and the event cursor, in the hub's SQLite file.
 *
 * Exactly-once into the outbox: a delivery's key is (Board message id + block index, bot), inserted with
 * INSERT OR IGNORE, so the watcher, a catch-up pass after a restart and a periodic reconcile can all see
 * the same event and only one row exists. The cursor only moves forward through sequential reads of the
 * feed (never from the watcher, whose runs are parallel per thread), so a crash can make the hub re-read
 * events but never skip one. Delivery to the bot is at-least-once with a stable `x-bnet-delivery` id.
 */
import { DatabaseSync } from "node:sqlite";

export interface OutboxItem {
  id: string;
  bot: string;
  url: string;
  body: string;
}

export interface DueDelivery extends OutboxItem {
  attempts: number;
}

export type DeliveryStatus = "pending" | "delivered" | "dead";

export class BoardOutbox {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS board_cursor (
        name TEXT PRIMARY KEY,
        cursor TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS board_outbox (
        id TEXT NOT NULL,
        bot TEXT NOT NULL,
        url TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        PRIMARY KEY (id, bot)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS board_outbox_due ON board_outbox (status, next_at);
    `);
  }

  cursor(name: string): string | null {
    const row = this.db.prepare("SELECT cursor FROM board_cursor WHERE name = ?").get(name) as { cursor: string } | undefined;
    return row?.cursor ?? null;
  }

  /** Inserts what is new (duplicates are ignored); returns how many rows were added. */
  enqueue(items: readonly OutboxItem[], now: Date = new Date()): number {
    return this.tx(() => this.insert(items, now));
  }

  /**
   * One sequential read's worth: its deliveries and the cursor after it, in one transaction, so the cursor
   * never gets ahead of what was recorded.
   */
  enqueueAndAdvance(items: readonly OutboxItem[], cursorName: string, cursor: string, now: Date = new Date()): number {
    return this.tx(() => {
      const added = this.insert(items, now);
      this.db
        .prepare("INSERT INTO board_cursor (name, cursor, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at")
        .run(cursorName, cursor, now.toISOString());
      return added;
    });
  }

  due(nowMs: number, limit = 10): DueDelivery[] {
    return this.db
      .prepare("SELECT id, bot, url, body, attempts FROM board_outbox WHERE status = 'pending' AND next_at <= ? ORDER BY next_at, created_at LIMIT ?")
      .all(nowMs, limit) as unknown as DueDelivery[];
  }

  markDelivered(id: string, bot: string, now: Date = new Date()): void {
    this.db.prepare("UPDATE board_outbox SET status = 'delivered', attempts = attempts + 1, delivered_at = ?, last_error = NULL WHERE id = ? AND bot = ?").run(now.toISOString(), id, bot);
  }

  /** Records a failed attempt: retry at `nextAt`, or give up (`dead`) when `nextAt` is null. */
  markFailed(id: string, bot: string, error: string, nextAt: number | null): void {
    this.db
      .prepare("UPDATE board_outbox SET attempts = attempts + 1, last_error = ?, status = ?, next_at = COALESCE(?, next_at) WHERE id = ? AND bot = ?")
      .run(error.slice(0, 200), nextAt === null ? "dead" : "pending", nextAt, id, bot);
  }

  /** For tests and the operator: one row's state. */
  get(id: string, bot: string): { status: DeliveryStatus; attempts: number; lastError: string | null } | null {
    const r = this.db.prepare("SELECT status, attempts, last_error FROM board_outbox WHERE id = ? AND bot = ?").get(id, bot) as
      | { status: DeliveryStatus; attempts: number; last_error: string | null }
      | undefined;
    return r ? { status: r.status, attempts: Number(r.attempts), lastError: r.last_error } : null;
  }

  counts(): Record<DeliveryStatus, number> {
    const out: Record<DeliveryStatus, number> = { pending: 0, delivered: 0, dead: 0 };
    for (const r of this.db.prepare("SELECT status, COUNT(*) AS n FROM board_outbox GROUP BY status").all() as Array<{ status: DeliveryStatus; n: number }>) out[r.status] = Number(r.n);
    return out;
  }

  /** Drops delivered rows older than `beforeMs` so the table stays small; dead rows stay for the operator. */
  prune(beforeMs: number): number {
    return Number(this.db.prepare("DELETE FROM board_outbox WHERE status = 'delivered' AND delivered_at < ?").run(new Date(beforeMs).toISOString()).changes);
  }

  close(): void {
    this.db.close();
  }

  private insert(items: readonly OutboxItem[], now: Date): number {
    const stmt = this.db.prepare("INSERT OR IGNORE INTO board_outbox (id, bot, url, body, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    let added = 0;
    for (const i of items) added += Number(stmt.run(i.id, i.bot, i.url, i.body, now.getTime(), now.toISOString()).changes);
    return added;
  }

  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
