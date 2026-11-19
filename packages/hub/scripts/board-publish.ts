/**
 * Publishes to the hub's board from any machine on the tailnet, as a bot (the orchestrator, say). It uses
 * the Board SDK, which reads BOARD_URL and BOARD_TOKEN from the environment:
 *
 *   BOARD_URL=https://<hub>.tail0fake.ts.net/api/board BOARD_TOKEN="$(cat ~/.config/b-net/board-token)" \
 *     node packages/hub/scripts/board-publish.ts pr b-net Facundo-Barbera/b-net#5 --title "web: centro de trabajo" [--state en_curso]
 *
 *   ... board-publish.ts event b-net question --bot fstack-vps --summary "¿Fusiono el PR?" [--thread th_01] [--link https://…]
 *
 * `pr` starts (or finds) one thread per PR in `<slug>/prs`, labelled project=, pr= and state= (a WorkState;
 * `listo` reads as merged). Posting the same PR again only moves its state label. `event` posts a
 * `bnet.event@1` block in `<slug>/eventos`, which the hub turns into a webhook for `--bot` when that bot
 * is configured for the project. Neither prints the token.
 */
import {
  BNET_EVENT_ID,
  BNET_EVENT_KINDS,
  BNET_EVENT_SCHEMA,
  BNET_EVENT_VERSION,
  BOARD_LABELS,
  BnetEventV1Schema,
  PrRefSchema,
  ProjectId,
  WorkStateSchema,
  boardChannel,
  prUrlOf,
} from "@b-net/core";
import { BoardError, block, board } from "@vercel/board";

const usage = `usage:
  board-publish.ts pr <slug> <owner/repo#n> [--title <text>] [--state en_espera|en_curso|listo|bloqueado]
  board-publish.ts event <slug> <${BNET_EVENT_KINDS.join("|")}> --bot <bot> --summary <text> [--thread <id>] [--link <url>]
env: BOARD_URL (https://<hub>.tail0fake.ts.net/api/board) and BOARD_TOKEN (a bot token from board-token.ts)`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i];
    const v = args[i + 1];
    if (!k?.startsWith("--") || v === undefined) fail(usage);
    out[k.slice(2)] = v;
  }
  return out;
}

const [cmd, slugArg, third, ...rest] = process.argv.slice(2);
if (!process.env.BOARD_URL || !process.env.BOARD_TOKEN) fail(usage);
const slug = ProjectId.safeParse(slugArg);
if (!cmd || !slug.success) fail(usage);

const team = board();

try {
  if (cmd === "pr") {
    const ref = PrRefSchema.safeParse(third);
    if (!ref.success) fail("the PR must look like owner/repo#123");
    const f = flags(rest);
    const state = WorkStateSchema.safeParse(f.state ?? "en_curso");
    if (!state.success) fail("--state must be en_espera, en_curso, listo or bloqueado");
    // The post's id makes it idempotent: the same PR posted twice is one thread.
    const posted = await team.post(boardChannel(slug.data, "prs"), {
      id: `pr-${ref.data.replace(/[^A-Za-z0-9]+/g, "-")}`.slice(0, 120),
      text: `${f.title ?? ref.data}\n\n${prUrlOf(ref.data)}`,
      labels: { [BOARD_LABELS.project]: slug.data, [BOARD_LABELS.pr]: ref.data, [BOARD_LABELS.state]: state.data },
    });
    if (posted.labels[BOARD_LABELS.state] !== state.data) await team.label(posted.id, { set: { [BOARD_LABELS.state]: state.data } });
    console.log(posted.id);
  } else if (cmd === "event") {
    const f = flags(rest);
    const event = BnetEventV1Schema.safeParse({
      schema: BNET_EVENT_SCHEMA,
      version: BNET_EVENT_VERSION,
      kind: third,
      project: slug.data,
      bot: f.bot,
      ...(f.thread ? { thread: f.thread } : {}),
      summary: f.summary,
      ...(f.link ? { link: f.link } : {}),
      at: new Date().toISOString(),
    });
    if (!event.success) fail(`invalid event: ${event.error.issues[0]?.path.join(".")} ${event.error.issues[0]?.message}`);
    const labels: Record<string, string> = { [BOARD_LABELS.project]: slug.data, [BOARD_LABELS.bot]: event.data.bot };
    if (event.data.thread) labels[BOARD_LABELS.thread] = event.data.thread;
    const posted = await team.post(boardChannel(slug.data, "eventos"), {
      text: `${event.data.summary}\n\n${block(BNET_EVENT_ID, { ...event.data })}`,
      labels,
    });
    console.log(posted.id);
  } else {
    fail(usage);
  }
} catch (e) {
  // BoardError messages are the board's words (no token in them); anything else, just its class.
  console.error(e instanceof BoardError ? `board: ${e.code}: ${e.message}` : `failed: ${e instanceof Error ? e.name : "error"}`);
  process.exit(1);
}
