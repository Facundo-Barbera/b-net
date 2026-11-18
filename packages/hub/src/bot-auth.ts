/**
 * Per-bot bearer tokens for the hub's write API. The hub only ever holds sha256(token):
 * tokens are 32 random bytes, so a fast hash is enough (no password stretching needed),
 * and a leaked token file does not let anyone write.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface BotToken {
  name: string;
  /** Lowercase hex sha256 of the raw token. */
  tokenSha256: string;
}

export const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** A fresh token in the form bots send it (base64url, 256 bits). */
export const generateToken = () => randomBytes(32).toString("base64url");

export function bearer(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m ? m[1]! : null;
}

/** Name of the bot owning the presented bearer token, or null. Compares against every entry in constant time. */
export function botFromAuth(header: string | null, bots: readonly BotToken[]): string | null {
  const token = bearer(header);
  if (!token) return null;
  const presented = createHash("sha256").update(token, "utf8").digest();
  let match: string | null = null;
  for (const b of bots) {
    if (timingSafeEqual(presented, Buffer.from(b.tokenSha256, "hex")) && match === null) match = b.name;
  }
  return match;
}
