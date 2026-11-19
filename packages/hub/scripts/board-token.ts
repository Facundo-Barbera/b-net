/**
 * Board tokens of the bots (run on the hub machine):
 *
 *   HUB_DATA_DIR=/var/lib/b-net node packages/hub/scripts/board-token.ts create <bot>
 *   ... board-token.ts list
 *   ... board-token.ts revoke <bot>
 *
 * `create` makes or rotates the bot's token and prints it ONCE on stdout (pipe it straight into
 * the bot's secret store); only sha256(token) goes to <HUB_DATA_DIR>/hub.sqlite. The hub reads
 * tokens per request, so a rotation or a revocation applies without a restart. The token reaches
 * only the `<slug>/` channels of the projects whose ownerBot is this bot.
 */
import { join } from "node:path";
import { BotName } from "@b-net/core";
import { SqliteBoardTokenStore } from "../src/board/tokens.ts";

const usage = "uso: HUB_DATA_DIR=<dir> board-token.ts create <bot> | list | revoke <bot>";
const [cmd, rawBot] = process.argv.slice(2);
const dataDir = process.env.HUB_DATA_DIR;
if (!dataDir || !cmd || (cmd !== "list" && !rawBot)) {
  console.error(usage);
  process.exit(2);
}
const bot = rawBot === undefined ? undefined : BotName.safeParse(rawBot);
if (bot && !bot.success) {
  console.error("el nombre del bot debe ser minúsculas a-z 0-9 . _ - (máx. 63)");
  process.exit(2);
}

const store = new SqliteBoardTokenStore(join(dataDir, "hub.sqlite"));
try {
  if (cmd === "create") {
    const token = store.issue(bot!.data!);
    // The notice goes to stderr so stdout carries only the token.
    console.error(`token de Board para ${bot!.data} (se muestra una sola vez; solo se guarda su hash):`);
    console.log(token);
  } else if (cmd === "revoke") {
    console.error(store.revoke(bot!.data!) ? `revocado ${bot!.data}` : `${bot!.data} no tiene token`);
  } else if (cmd === "list") {
    for (const t of store.list()) console.log(`${t.bot}\t${t.createdAt}`);
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} finally {
  store.close();
}
