/**
 * Per-bot bearer tokens for Board, in the hub's SQLite file. Same pattern as the per-machine ingest
 * tokens (metrics-store.ts): 256 random bits, only sha256(token) stored, lookup by hash, one token per
 * bot (issuing again rotates it). The running hub reads per request, so issue/revoke need no restart.
 */
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const hashBoardToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Prefixed so a leaked token is recognisable by secret scanners and in a misdirected paste. */
export const generateBoardToken = () => `bnet_board_${randomBytes(32).toString("base64url")}`;

export class BoardTokenStore {
  private readonly db: DatabaseSync;

  /** ":memory:" for tests; otherwise the hub's hub.sqlite (separate connection, WAL). */
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 2000;
      CREATE TABLE IF NOT EXISTS board_bot_tokens (
        token_hash TEXT PRIMARY KEY,
        bot TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) WITHOUT ROWID;
    `);
  }

  /** Creates or rotates the bot's token and returns it. The caller prints it once; it is not kept. */
  issue(bot: string, now: Date = new Date()): string {
    const token = generateBoardToken();
    this.db
      .prepare(
        `INSERT INTO board_bot_tokens (token_hash, bot, created_at) VALUES (?, ?, ?)
         ON CONFLICT(bot) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at`,
      )
      .run(hashBoardToken(token), bot, now.toISOString());
    return token;
  }

  revoke(bot: string): boolean {
    return Number(this.db.prepare("DELETE FROM board_bot_tokens WHERE bot = ?").run(bot).changes) > 0;
  }

  /** The bot a presented token belongs to, or null. */
  botForToken(token: string): string | null {
    const row = this.db.prepare("SELECT bot FROM board_bot_tokens WHERE token_hash = ?").get(hashBoardToken(token)) as { bot: string } | undefined;
    return row?.bot ?? null;
  }

  list(): Array<{ bot: string; createdAt: string }> {
    return (this.db.prepare("SELECT bot, created_at FROM board_bot_tokens ORDER BY bot").all() as Array<{ bot: string; created_at: string }>).map((r) => ({
      bot: r.bot,
      createdAt: r.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }
}
