/**
 * Board tokens of the bots, in the hub's SQLite file. Separate from the write-API tokens
 * (HUB_BOT_TOKENS_FILE) on purpose: a Board token reaches the bot's project channels, so leaking
 * one must not also let it publish deliverables, and each can be rotated alone.
 *
 * Only sha256(token) is stored, as with the agents' ingest tokens: tokens are 256 random bits, so
 * a fast hash is enough and an indexed lookup by hash leaks nothing useful.
 */
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const hashBoardToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** 32 random bytes, base64url, prefixed so a leaked token is recognisable in logs and scanners. */
export const generateBoardToken = () => `bnet_board_${randomBytes(32).toString("base64url")}`;

export interface BoardTokenInfo {
  bot: string;
  createdAt: string;
}

export class SqliteBoardTokenStore {
  private readonly db: DatabaseSync;
  private closed = false;

  /** path ":memory:" for tests. May be the same file as the other hub stores (separate connection, WAL). */
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

  /** Creates or rotates the bot's token (one per bot, so a rotation kills the old one). Returns it in plaintext, once. */
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

  /** The bot the token belongs to, or null. Read per request, so revocations need no restart. */
  botForToken(token: string): string | null {
    const row = this.db.prepare("SELECT bot FROM board_bot_tokens WHERE token_hash = ?").get(hashBoardToken(token)) as
      | { bot: string }
      | undefined;
    return row?.bot ?? null;
  }

  list(): BoardTokenInfo[] {
    return (this.db.prepare("SELECT bot, created_at FROM board_bot_tokens ORDER BY bot").all() as Array<{ bot: string; created_at: string }>).map(
      (r) => ({ bot: r.bot, createdAt: r.created_at }),
    );
  }

  /** Idempotent: node:sqlite throws on a second close, and callers' cleanup paths may overlap. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
