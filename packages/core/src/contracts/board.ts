import { z } from "zod";
import { IsoTime } from "./machines.ts";
import { ProjectId } from "./projects.ts";

/* ------------------------------------------------------------------ *
 * Board (@vercel/board, mounted inside the hub at /api/board).
 *
 * Board is the engine: tasks, threads, events and watchers. b-net only
 * agrees on three things with whoever writes to it:
 * - one channel tree per project: `<project>/...` (`b-net/prs`, `b-net/events`)
 * - labels on thread roots: `project=<id>`, `pr=<owner/repo#n>`, `state=<word>`
 * - one versioned data block, `bnet.event@1`, for what a bot must hear about
 * The hub reads Board with the SDK and serves the UI a flat model
 * (GET /api/v1/board, BoardWork below); the browser never talks to Board.
 * ------------------------------------------------------------------ */

export const BOARD_BASE_PATH = "/api/board";

/** Label keys b-net reads. Board reserves `board.*` for itself (task state). */
export const BoardLabels = { project: "project", pr: "pr", state: "state" } as const;

/** `owner/repo#123`, the value of a `pr=` label. Kept strict so it can be turned into a GitHub URL safely. */
export const PrRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}#[1-9][0-9]{0,8}$/, "owner/repo#n");
export type PrRef = z.infer<typeof PrRef>;

export function prUrl(ref: PrRef): string {
  const [repo, n] = ref.split("#") as [string, string];
  return `https://github.com/${repo}/pull/${n}`;
}

/** Channel of a project's subtree, and the project a channel belongs to (its first segment). */
export const projectChannel = (project: ProjectId, leaf?: string) => (leaf ? `${project}/${leaf}` : `${project}/`);
export function projectOfChannel(channel: string): ProjectId | null {
  const first = channel.split("/")[0] ?? "";
  return ProjectId.safeParse(first).success ? first : null;
}

/* ------------------------------ bnet.event@1 ------------------------------ */

export const BNET_EVENT_SCHEMA = { name: "bnet.event", version: 1 } as const;
export const BNET_EVENT_ID = `${BNET_EVENT_SCHEMA.name}@${BNET_EVENT_SCHEMA.version}` as const;

/** The only kinds the hub forwards to a bot's webhook. */
export const BnetEventKind = z.enum(["thread_done", "question", "blocked"]);
export type BnetEventKind = z.infer<typeof BnetEventKind>;

/**
 * Data of a `bnet.event@1` block. `project` must equal the channel's project (the hub checks it, so a
 * message can't address another project's bot); `thread` is the T3 thread (or Board thread) it is about.
 */
export const BnetEvent = z
  .object({
    v: z.literal(1),
    kind: BnetEventKind,
    project: ProjectId,
    thread: z.string().min(1).max(200),
    summary: z.string().min(1).max(1000),
    link: z.url({ protocol: /^(https?|t3-thread)$/ }).max(600).nullable(),
  })
  .strict();
export type BnetEvent = z.infer<typeof BnetEvent>;

/**
 * The same shape as Board's JSON Schema, registered once with createSchema(). Board allows structural
 * keywords only (no `pattern`), so the slug and URL rules above are enforced again by the hub.
 */
export const BNET_EVENT_JSON_SCHEMA = {
  type: "object",
  required: ["v", "kind", "project", "thread", "summary", "link"],
  additionalProperties: false,
  properties: {
    v: { const: 1 },
    kind: { enum: ["thread_done", "question", "blocked"] },
    project: { type: "string", minLength: 1, maxLength: 63 },
    thread: { type: "string", minLength: 1, maxLength: 200 },
    summary: { type: "string", minLength: 1, maxLength: 1000 },
    link: { type: ["string", "null"], maxLength: 600 },
  },
} as const;

/** Webhook body the hub POSTs to a bot. `id` is stable across retries: receivers dedupe on it. */
export const BnetWebhookBody = z
  .object({
    id: z.string().min(1).max(200),
    board: z.object({ message: z.string(), channel: z.string(), at: IsoTime }).strict(),
    event: BnetEvent,
  })
  .strict();
export type BnetWebhookBody = z.infer<typeof BnetWebhookBody>;

/* --------------------------- read model for the UI --------------------------- */

export const BoardTaskState = z.enum(["waiting", "ready", "claimed", "blocked", "completed", "failed", "canceled"]);
export type BoardTaskState = z.infer<typeof BoardTaskState>;

export const BoardTask = z
  .object({
    id: z.string(),
    channel: z.string(),
    title: z.string().max(300),
    state: BoardTaskState,
    /** Who holds it (claimed) and until when; null otherwise. */
    claimedBy: z.string().nullable(),
    until: IsoTime.nullable(),
    /** Why it is blocked, failed or canceled; its result once completed. */
    note: z.string().max(1000).nullable(),
    pr: PrRef.nullable(),
    stateLabel: z.string().max(64).nullable(),
    replies: z.number().int().nonnegative(),
    updatedAt: IsoTime,
  })
  .strict();
export type BoardTask = z.infer<typeof BoardTask>;

/** A recent message in a project's channels ("avance"): a thread's latest word. */
export const BoardUpdate = z
  .object({
    id: z.string(),
    channel: z.string(),
    author: z.string(),
    text: z.string().max(400),
    at: IsoTime,
  })
  .strict();
export type BoardUpdate = z.infer<typeof BoardUpdate>;

export const BoardPr = z
  .object({
    ref: PrRef,
    url: z.string(),
    title: z.string().max(300),
    state: z.string().max(64).nullable(),
    at: IsoTime,
  })
  .strict();
export type BoardPr = z.infer<typeof BoardPr>;

export const BoardEventItem = z
  .object({
    id: z.string(),
    at: IsoTime,
    event: BnetEvent,
  })
  .strict();
export type BoardEventItem = z.infer<typeof BoardEventItem>;

export const BoardProject = z
  .object({
    project: ProjectId,
    tasks: z.array(BoardTask),
    updates: z.array(BoardUpdate),
    prs: z.array(BoardPr),
    events: z.array(BoardEventItem),
  })
  .strict();
export type BoardProject = z.infer<typeof BoardProject>;

/** GET /api/v1/board. `state` says whether the hub runs a board at all, so the UI can say what to connect. */
export const BoardWork = z
  .object({
    generatedAt: IsoTime,
    state: z.enum(["ok", "missing", "failing"]),
    error: z.string().nullable(),
    projects: z.array(BoardProject),
  })
  .strict();
export type BoardWork = z.infer<typeof BoardWork>;

/** Open = still needs someone; the order the UI lists them in (a person first, then running, then queued). */
export const OPEN_TASK_STATES: readonly BoardTaskState[] = ["blocked", "claimed", "ready", "waiting"];
