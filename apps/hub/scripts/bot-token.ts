/**
 * Mints a write token for one bot: `node apps/hub/scripts/bot-token.ts <bot-name>`.
 * Prints the raw token once (hand it to the bot) and the entry to append to the hub's
 * HUB_BOT_TOKENS_FILE, which only ever stores the hash.
 */
import { BotName } from "@fhub/core";
import { generateToken, hashToken } from "../src/bot-auth.ts";

const name = BotName.safeParse(process.argv[2]);
if (!name.success) {
  console.error("usage: node apps/hub/scripts/bot-token.ts <bot-name>  (lowercase a-z 0-9 . _ -)");
  process.exit(2);
}
const token = generateToken();
console.log(`token (give to ${name.data}, not stored anywhere): ${token}`);
console.log(`entry for HUB_BOT_TOKENS_FILE "bots": ${JSON.stringify({ name: name.data, tokenSha256: hashToken(token) })}`);
