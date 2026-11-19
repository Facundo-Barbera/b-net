/**
 * Publishes to the hub's board from any machine on the tailnet, as a bot (the orchestrator, say). It uses
 * the Board SDK, which reads BOARD_URL and BOARD_TOKEN from the environment:
 *
 *   BOARD_URL=https://<hub>.tail0fake.ts.net/api/board BOARD_TOKEN="$(cat ~/.config/b-net/board-token)" \
 *     node packages/hub/scripts/board-publish.ts pr b-net Facundo-Barbera/b-net#5 --title "web: centro de trabajo" [--state open]
 *
 *   ... board-publish.ts event b-net question --thread th_01 --summary "¿Fusiono el PR?" [--link https://…]
 *
 * `pr` starts (or finds) one thread per PR in `<project>/prs` with labels project=, pr= and state=; posting
 * the same PR again only updates its state label. `event` posts a `bnet.event@1` block in
 * `<project>/events`, which the hub turns into a webhook for the project's bot. Neither prints the token.
 */
import { BnetEvent, BnetEventKind, PrRef, ProjectId, prUrl, projectChannel } from "@b-net/core";
import { BoardError, block, board } from "@vercel/board";

const usage = `usage:
  board-publish.ts pr <project> <owner/repo#n> [--title <text>] [--state <word>]
  board-publish.ts event <project> <thread_done|question|blocked> --thread <id> --summary <text> [--link <url>]
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

const [cmd, projectArg, third, ...rest] = process.argv.slice(2);
if (!process.env.BOARD_URL || !process.env.BOARD_TOKEN) fail(usage);
const project = ProjectId.safeParse(projectArg);
if (!cmd || !project.success) fail(usage);

const team = board();

try {
  if (cmd === "pr") {
    const ref = PrRef.safeParse(third);
    if (!ref.success) fail("the PR must look like owner/repo#123");
    const f = flags(rest);
    const state = (f.state ?? "open").slice(0, 64);
    const title = f.title ?? ref.data;
    // The post's id makes it idempotent: the same PR posted twice is one thread.
    const posted = await team.post(projectChannel(project.data, "prs"), {
      id: `pr-${ref.data.replace(/[^A-Za-z0-9]+/g, "-")}`.slice(0, 120),
      text: `${title}\n\n${prUrl(ref.data)}`,
      labels: { project: project.data, pr: ref.data, state },
    });
    if (posted.labels.state !== state) await team.label(posted.id, { set: { state } });
    console.log(posted.id);
  } else if (cmd === "event") {
    const kind = BnetEventKind.safeParse(third);
    if (!kind.success) fail("kind must be thread_done, question or blocked");
    const f = flags(rest);
    const event = BnetEvent.safeParse({ v: 1, kind: kind.data, project: project.data, thread: f.thread, summary: f.summary, link: f.link ?? null });
    if (!event.success) fail(`invalid event: ${event.error.issues[0]?.path.join(".")} ${event.error.issues[0]?.message}`);
    const posted = await team.post(projectChannel(project.data, "events"), {
      text: `${event.data.summary}\n\n${block("bnet.event@1", event.data)}`,
      labels: { project: project.data },
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
