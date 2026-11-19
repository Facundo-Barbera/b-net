/**
 * Board tokens for bots (run on the hub machine, as the hub's user):
 *
 *   HUB_DATA_DIR=/var/lib/b-net node packages/hub/scripts/board-token.ts issue <bot>
 *   ... board-token.ts revoke <bot>
 *   ... board-token.ts list
 *
 * `issue` creates or rotates the bot's token and prints it ONCE on stdout, so it can go straight into the
 * bot's secret store (`… issue fstack-vps > /path/only/the/bot/reads`). Only sha256(token) is written, to
 * <HUB_DATA_DIR>/hub.sqlite. The running hub checks tokens per request: issue and revoke need no restart.
 * A bot also has to be in HUB_BOARD_CONFIG_FILE (that is where its projects come from), or its token is
 * refused.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BoardBotName } from "../src/board/config.ts";
import { BoardTokenStore } from "../src/board/tokens.ts";

const usage = "usage: HUB_DATA_DIR=<dir> board-token.ts issue <bot> | revoke <bot> | list";
const [cmd, bot] = process.argv.slice(2);
const dataDir = process.env.HUB_DATA_DIR;
if (!dataDir || !cmd || (cmd !== "list" && !bot)) {
  console.error(usage);
  process.exit(2);
}
if (bot && !BoardBotName.safeParse(bot).success) {
  console.error("bot name must be a-z, 0-9, '-' (max 32, starts with a letter)");
  process.exit(2);
}

if (cmd === "issue") {
  // Warn early instead of handing out a token the hub will refuse.
  const file = process.env.HUB_BOARD_CONFIG_FILE;
  try {
    const bots = file ? Object.keys((JSON.parse(readFileSync(file, "utf8")) as { bots?: Record<string, unknown> }).bots ?? {}) : [];
    if (!bots.includes(bot!)) console.error(`warning: ${bot} is not in HUB_BOARD_CONFIG_FILE; the hub refuses its token until it is (and restarts)`);
  } catch {
    console.error("warning: HUB_BOARD_CONFIG_FILE not readable; bot not checked");
  }
}

const store = new BoardTokenStore(join(dataDir, "hub.sqlite"));
try {
  if (cmd === "issue") {
    const token = store.issue(bot!);
    console.error(`token for ${bot} (shown once; only its hash is stored):`);
    console.log(token);
  } else if (cmd === "revoke") {
    console.error(store.revoke(bot!) ? `revoked ${bot}` : `no token for ${bot}`);
  } else if (cmd === "list") {
    for (const t of store.list()) console.log(`${t.bot}\t${t.createdAt}`);
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} finally {
  store.close();
}
