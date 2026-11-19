/**
 * What the UI reads of Board (GET /api/v1/board/projects, BoardProjectsResponse in the shared contract),
 * read with the SDK through the hub's own handle. Per project: tasks with their WorkState, updates from
 * `<slug>/avances`, PRs from `<slug>/prs`, bnet events from `<slug>/eventos` and the HTML summaries the
 * hub already stores as deliverables. A few reads per project and capped lists, because the UI polls it.
 */
import { z } from "zod";
import {
  BNET_EVENT_KINDS,
  BNET_EVENT_SCHEMA,
  BNET_EVENT_VERSION,
  BOARD_LABELS,
  boardChannel,
  ProjectId,
  type BnetEventV1,
  type BoardProjectsResponse,
  type BoardProjectView,
  type BoardPrView,
  type BoardTaskView,
  type BoardUpdateView,
  type ProjectCatalogEntry,
  type WorkState,
} from "@b-net/core";
import type { Board, MessageView, TaskView } from "@vercel/board";

export const MAX_PROJECTS = 30;
const DONE_KEEP = 10;

/** `owner/repo#123`. Strict, so a `pr=` label can be turned into a GitHub URL safely. */
const PR_REF = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}#[1-9][0-9]{0,8}$/;
const prUrl = (ref: string) => {
  const [repo, n] = ref.split("#") as [string, string];
  return `https://github.com/${repo}/pull/${n}`;
};

/**
 * Reading shape of a `bnet.event@1` block, enough to show it. Board already checked the block against the
 * registered schema when it was written; the events module owns the stricter checks used for webhooks.
 */
const ShownEvent = z.object({
  schema: z.literal(BNET_EVENT_SCHEMA),
  version: z.literal(BNET_EVENT_VERSION),
  kind: z.enum(BNET_EVENT_KINDS),
  project: z.string(),
  bot: z.string(),
  thread: z.string().optional(),
  summary: z.string(),
  link: z.string().optional(),
  at: z.string(),
});

/** The project slug of a channel (its first segment), or null. */
export function projectOfChannel(channel: string): string | null {
  const first = channel.split("/")[0] ?? "";
  return ProjectId.safeParse(first).success ? first : null;
}

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

/** Text without data fences, collapsed, for titles and excerpts. */
export function plainText(text: string, max: number): string {
  const noFences = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  return noFences.length > max ? `${noFences.slice(0, max - 1)}…` : noFences;
}

const firstLine = (text: string, max: number) => plainText(text.split("\n").find((l) => l.trim() && !l.startsWith("```")) ?? "", max) || "(sin texto)";
const firstUrl = (text: string) => /https?:\/\/[^\s)>\]]+/.exec(text)?.[0];

/**
 * Board's task state in b-net's words. A lease that ran out is over even before Board's timer says so
 * (Board's "Build a UI" guide), so it reads as waiting. Canceled tasks are dropped (null).
 */
export function workStateOf(task: Pick<TaskView, "state" | "claim">, now: number): WorkState | null {
  switch (task.state) {
    case "claimed":
      return task.claim && Date.parse(task.claim.until) <= now ? "en_espera" : "en_curso";
    case "ready":
    case "waiting":
      return "en_espera";
    case "blocked":
    case "failed":
      return "bloqueado";
    case "completed":
      return "listo";
    default:
      return null;
  }
}

/**
 * A PR's state from its `state=` label. The contract keeps a WorkState in that label, so `listo` reads as
 * merged; the PR words themselves (`fusionado`, `cerrado`, `abierto`) are taken as they are.
 */
export function prStateOf(label: string | undefined): BoardPrView["state"] {
  if (label === "fusionado" || label === "listo") return "fusionado";
  if (label === "cerrado") return "cerrado";
  return "abierto";
}

const ORDER: Record<WorkState, number> = { bloqueado: 0, en_curso: 1, en_espera: 2, listo: 3 };

function toTask(message: MessageView, last: MessageView | null, now: number): BoardTaskView | null {
  const t = message.task;
  if (!t) return null;
  const state = workStateOf(t, now);
  if (!state) return null;
  const task: BoardTaskView = { id: message.id, title: firstLine(message.text, 300), state, updatedAt: last?.createdAt ?? message.createdAt };
  if (state === "en_curso" && t.claim) {
    task.claimedBy = actorLabel(t.claim.actor);
    task.leaseUntil = t.claim.until;
  }
  const pr = message.labels[BOARD_LABELS.pr];
  if (pr && PR_REF.test(pr)) task.pr = pr;
  const thread = message.labels[BOARD_LABELS.thread];
  if (thread) task.thread = thread.slice(0, 200);
  return task;
}

export interface ReadDeps {
  /** Projects and deliverables the hub stores (names and HTML summaries); empty without HUB_DATA_DIR. */
  catalog: () => readonly ProjectCatalogEntry[];
  /** The bot that owns a project, when the access config names one (injected; none by default). */
  ownerOf: (slug: string) => string | undefined;
  /** Projects to list even before anything was written there (configured bots' projects, injected). */
  knownProjects: () => readonly string[];
}

export async function readProject(team: Board, slug: string, deps: ReadDeps, now: number): Promise<BoardProjectView> {
  const [tasksPage, updatesPage, prPage, feed] = await Promise.all([
    team.tasks.list({ channel: `${slug}/`, state: "all", limit: 100 }),
    team.threads({ channel: boardChannel(slug, "avances"), limit: 20 }),
    team.threads({ channel: boardChannel(slug, "prs"), label: [BOARD_LABELS.pr], limit: 50 }),
    team.poll({ channel: boardChannel(slug, "eventos"), text: `${BNET_EVENT_SCHEMA}@${BNET_EVENT_VERSION}`, last: 20 }),
  ]);

  const tasks = tasksPage.tasks.map((s) => toTask(s.message, s.last, now)).filter((t): t is BoardTaskView => t !== null);
  const open = tasks.filter((t) => t.state !== "listo").sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.updatedAt.localeCompare(a.updatedAt));
  const done = tasks.filter((t) => t.state === "listo").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, DONE_KEEP);

  const updates: BoardUpdateView[] = updatesPage.threads
    .map(({ message, last }) => last ?? message)
    .filter((m) => !m.deleted && plainText(m.text, 400) !== "")
    .map((m) => {
      const u: BoardUpdateView = { id: m.id, text: plainText(m.text, 400), author: actorLabel(m.by?.actor), at: m.createdAt };
      const link = firstUrl(m.text);
      if (link) u.link = link;
      return u;
    })
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  const prs = new Map<string, BoardPrView>();
  for (const { message, last } of prPage.threads) {
    const ref = message.labels[BOARD_LABELS.pr];
    if (!ref || !PR_REF.test(ref)) continue;
    const updatedAt = last?.createdAt ?? message.createdAt;
    const seen = prs.get(ref);
    if (seen && seen.updatedAt >= updatedAt) continue;
    prs.set(ref, { ref, title: firstLine(message.text, 300), url: prUrl(ref), state: prStateOf(message.labels[BOARD_LABELS.state]), updatedAt });
  }

  const events: BnetEventV1[] = [];
  for (const e of feed.events) {
    if (e.type !== "message.posted" || !e.message || e.message.deleted) continue;
    for (const b of e.message.blocks) {
      if (b.schema !== BNET_EVENT_SCHEMA || b.version !== BNET_EVENT_VERSION) continue;
      const parsed = ShownEvent.safeParse(b.data);
      if (parsed.success && parsed.data.project === slug) events.push(parsed.data as BnetEventV1);
    }
  }
  events.sort((a, b) => b.at.localeCompare(a.at));

  const entry = deps.catalog().find((c) => c.project.id === slug);
  const summaries = (entry?.deliverables ?? [])
    .filter((d) => d.kind === "html")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map((d) => ({ id: d.id, title: d.title, at: d.createdAt }));

  const view: BoardProjectView = {
    slug,
    name: entry?.project.name ?? slug,
    tasks: [...open, ...done],
    updates,
    prs: [...prs.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    events: events.slice(0, 20),
    summaries,
  };
  const bot = deps.ownerOf(slug);
  if (bot) view.bot = bot;
  return view;
}

/** Projects with channels on the board, plus the known ones, capped. */
export async function boardProjects(team: Board, known: readonly string[]): Promise<string[]> {
  const found = new Set(known.filter((p) => ProjectId.safeParse(p).success));
  const { channels } = await team.channels({ limit: 500 });
  for (const c of channels) {
    const p = projectOfChannel(c.path);
    if (p) found.add(p);
  }
  return [...found].sort().slice(0, MAX_PROJECTS);
}

export async function readBoardProjects(team: Board, deps: ReadDeps, now: Date): Promise<BoardProjectsResponse> {
  const slugs = await boardProjects(team, deps.knownProjects());
  const projects = await Promise.all(slugs.map((s) => readProject(team, s, deps, now.getTime())));
  return { projects, generatedAt: now.toISOString() };
}
