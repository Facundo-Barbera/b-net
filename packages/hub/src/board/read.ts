/**
 * The UI's view of Board (GET /api/v1/board), read with the SDK through the hub's own handle. Per
 * project: its tasks by state, its latest updates, the PRs labelled `pr=` and its recent bnet events.
 * Kept small on purpose (a few reads per project, capped lists) because the UI polls it.
 */
import {
  BNET_EVENT_SCHEMA,
  BnetEvent,
  OPEN_TASK_STATES,
  PrRef,
  prUrl,
  projectOfChannel,
  type BoardEventItem,
  type BoardPr,
  type BoardProject,
  type BoardTask,
  type BoardTaskState,
  type BoardUpdate,
  type BoardWork,
} from "@b-net/core";
import type { Board, MessageView } from "@vercel/board";
import { BNET_EVENT_TEXT } from "./events.ts";

export const MAX_PROJECTS = 30;
const FINISHED_KEEP = 10;

/** Who an actor id is to a person: `bnet:bot:x` → x, `tailscale:user:ada@x` → ada, `board:client…` → hub. */
export function actorLabel(id: string | null | undefined): string {
  if (!id) return "—";
  const [principal, profile] = id.split("+") as [string, string | undefined];
  let who = principal;
  if (principal.startsWith("bnet:bot:")) who = principal.slice(9);
  else if (principal.startsWith("tailscale:user:")) who = principal.slice(15).split("@")[0] || principal;
  else if (principal.startsWith("board:watch:")) who = principal.slice(12);
  else if (principal.startsWith("board:client")) who = "hub";
  return profile ? `${profile} vía ${who}` : who;
}

/** First line of a message without data fences, for titles and excerpts. */
export function plainText(text: string, max: number): string {
  const noFences = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  return noFences.length > max ? `${noFences.slice(0, max - 1)}…` : noFences;
}

const firstLine = (text: string, max: number) => plainText(text.split("\n").find((l) => l.trim() && !l.startsWith("```")) ?? "", max) || "(sin texto)";

const ORDER: Record<BoardTaskState, number> = { blocked: 0, claimed: 1, ready: 2, waiting: 3, failed: 4, completed: 5, canceled: 6 };

function toTask(summary: { message: MessageView; replies: number; last: MessageView | null }, now: number): BoardTask | null {
  const { message, replies, last } = summary;
  const t = message.task;
  if (!t) return null;
  // A lease that ran out is over even before the board's timer says so (see Board's "Build a UI" guide).
  const expired = t.state === "claimed" && t.claim !== null && Date.parse(t.claim.until) <= now;
  const state: BoardTaskState = expired ? "ready" : t.state;
  const pr = PrRef.safeParse(message.labels?.pr);
  return {
    id: message.id,
    channel: message.channel,
    title: firstLine(message.text, 300),
    state,
    claimedBy: state === "claimed" && t.claim ? actorLabel(t.claim.actor) : null,
    until: state === "claimed" && t.claim ? t.claim.until : null,
    note: (t.blocked?.reason ?? t.reason ?? t.result ?? null)?.slice(0, 1000) ?? null,
    pr: pr.success ? pr.data : null,
    stateLabel: message.labels?.state?.slice(0, 64) ?? null,
    replies,
    updatedAt: last?.createdAt ?? message.createdAt,
  };
}

export async function readProject(team: Board, project: string, now: number): Promise<BoardProject> {
  const tree = `${project}/`;
  const [tasksPage, threadsPage, prPage, feed] = await Promise.all([
    team.tasks.list({ channel: tree, state: "all", limit: 100 }),
    team.threads({ channel: tree, limit: 20 }),
    team.threads({ channel: tree, label: ["pr"], limit: 50 }),
    team.poll({ channel: tree, text: BNET_EVENT_TEXT, last: 20 }),
  ]);

  const tasks = tasksPage.tasks.map((s) => toTask(s, now)).filter((t): t is BoardTask => t !== null);
  const open = tasks.filter((t) => OPEN_TASK_STATES.includes(t.state));
  const finished = tasks.filter((t) => !OPEN_TASK_STATES.includes(t.state)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, FINISHED_KEEP);
  open.sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updatedAt.localeCompare(a.updatedAt));

  const updates: BoardUpdate[] = threadsPage.threads
    .map(({ message, last }) => last ?? message)
    .filter((m) => !m.deleted && plainText(m.text, 400) !== "")
    .map((m) => ({ id: m.id, channel: m.channel, author: actorLabel(m.by?.actor), text: plainText(m.text, 400), at: m.createdAt }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  const prs = new Map<string, BoardPr>();
  for (const { message, last } of prPage.threads) {
    const ref = PrRef.safeParse(message.labels?.pr);
    if (!ref.success) continue;
    const at = last?.createdAt ?? message.createdAt;
    const seen = prs.get(ref.data);
    if (seen && seen.at >= at) continue;
    prs.set(ref.data, { ref: ref.data, url: prUrl(ref.data), title: firstLine(message.text, 300), state: message.labels?.state?.slice(0, 64) ?? null, at });
  }

  const events: BoardEventItem[] = [];
  for (const e of feed.events) {
    if (e.type !== "message.posted" || !e.message || e.message.deleted) continue;
    e.message.blocks.forEach((b, i) => {
      if (b.schema !== BNET_EVENT_SCHEMA.name || b.version !== BNET_EVENT_SCHEMA.version) return;
      const parsed = BnetEvent.safeParse(b.data);
      if (parsed.success && parsed.data.project === project) events.push({ id: `${e.message!.id}:${i}`, at: e.message!.createdAt, event: parsed.data });
    });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));

  return {
    project,
    tasks: [...open, ...finished],
    updates,
    prs: [...prs.values()].sort((a, b) => b.at.localeCompare(a.at)),
    events: events.slice(0, 20),
  };
}

/** Projects that have channels on the board, plus the ones bots are configured for, capped. */
export async function boardProjects(team: Board, configured: readonly string[]): Promise<string[]> {
  const found = new Set(configured.filter((p) => p !== "*"));
  const { channels } = await team.channels({ limit: 500 });
  for (const c of channels) {
    const p = projectOfChannel(c.path);
    if (p) found.add(p);
  }
  return [...found].sort().slice(0, MAX_PROJECTS);
}

export async function readBoardWork(team: Board, configured: readonly string[], now: Date): Promise<BoardWork> {
  const projects = await boardProjects(team, configured);
  const read = await Promise.all(projects.map((p) => readProject(team, p, now.getTime())));
  return { generatedAt: now.toISOString(), state: "ok", error: null, projects: read };
}
