/**
 * Runtime checks for the shared Board contract (contracts/board.ts, which is types and constants only and
 * is copied verbatim across branches). Everything here derives from the contract's constants and uses
 * names the contract does not, so both can be re-exported from the package root.
 */
import { z } from "zod";
import {
  BNET_EVENT_KINDS,
  BNET_EVENT_SCHEMA,
  BNET_EVENT_VERSION,
  BOARD_CHANNEL_KINDS,
  WORK_STATES,
  type BnetEventV1,
  type BoardChannelKind,
  type BoardProjectsResponse,
} from "./contracts/board.ts";
import { IsoTime } from "./contracts/machines.ts";
import { ProjectId } from "./contracts/projects.ts";

/** `bnet.event@1`, as Board names a schema version in a block's fence. */
export const BNET_EVENT_ID = `${BNET_EVENT_SCHEMA}@${BNET_EVENT_VERSION}`;

/** Bot names (also Board principal ids `bnet:bot:<name>`, see the hub's board/auth.ts). */
export const BoardBotNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "a-z, 0-9, '-' (max 32, starts with a letter)");

/** `owner/repo#123`, the value of a `pr=` label. Strict, so it can be turned into a GitHub URL safely. */
export const PrRefSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}#[1-9][0-9]{0,8}$/, "owner/repo#n");

export function prUrlOf(ref: string): string {
  const [repo, n] = ref.split("#") as [string, string];
  return `https://github.com/${repo}/pull/${n}`;
}

export const WorkStateSchema = z.enum(WORK_STATES);

/** The project slug of a channel (its first segment), or null. */
export function projectOfChannel(channel: string): string | null {
  const first = channel.split("/")[0] ?? "";
  return ProjectId.safeParse(first).success ? first : null;
}

/** The channel kind (`tareas`, `avances`, `prs`, `eventos`) of `<slug>/<kind>`, or null for anything else. */
export function channelKindOf(channel: string): BoardChannelKind | null {
  const parts = channel.split("/");
  const kind = parts[1];
  return parts.length === 2 && (BOARD_CHANNEL_KINDS as readonly string[]).includes(kind ?? "") ? (kind as BoardChannelKind) : null;
}

const LinkSchema = z.url({ protocol: /^(https?|t3-thread)$/ }).max(600);

/** BnetEventV1 at runtime. The hub also checks that `project` is the channel's and `bot` is the project's. */
export const BnetEventV1Schema: z.ZodType<BnetEventV1> = z
  .object({
    schema: z.literal(BNET_EVENT_SCHEMA),
    version: z.literal(BNET_EVENT_VERSION),
    kind: z.enum(BNET_EVENT_KINDS),
    project: ProjectId,
    bot: BoardBotNameSchema,
    thread: z.string().min(1).max(200).optional(),
    summary: z.string().min(1).max(1000),
    link: LinkSchema.optional(),
    at: IsoTime,
  })
  .strict();

/**
 * The same shape as Board's JSON Schema, registered once with createSchema(). Board takes structural
 * keywords only (no `pattern`), so slug, bot and URL rules are enforced again by BnetEventV1Schema.
 */
export const BNET_EVENT_JSON_SCHEMA = {
  type: "object",
  required: ["schema", "version", "kind", "project", "bot", "summary", "at"],
  additionalProperties: false,
  properties: {
    schema: { const: BNET_EVENT_SCHEMA },
    version: { const: BNET_EVENT_VERSION },
    kind: { enum: [...BNET_EVENT_KINDS] },
    project: { type: "string", minLength: 1, maxLength: 63 },
    bot: { type: "string", minLength: 1, maxLength: 32 },
    thread: { type: "string", minLength: 1, maxLength: 200 },
    summary: { type: "string", minLength: 1, maxLength: 1000 },
    link: { type: "string", maxLength: 600 },
    at: { type: "string", format: "date-time" },
  },
};

/** What the hub POSTs to a bot's webhook. `id` is stable across retries: receivers dedupe on it. */
export const BnetWebhookBodySchema = z
  .object({
    id: z.string().min(1).max(200),
    board: z.object({ message: z.string(), channel: z.string(), at: IsoTime }).strict(),
    event: BnetEventV1Schema,
  })
  .strict();
export type BnetWebhookBody = z.infer<typeof BnetWebhookBodySchema>;

const TaskViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: WorkStateSchema,
  claimedBy: z.string().optional(),
  leaseUntil: IsoTime.optional(),
  pr: z.string().optional(),
  thread: z.string().optional(),
  updatedAt: IsoTime,
});

/** BoardProjectsResponse at runtime, for the web client (a hub with another shape fails here, not in a view). */
export const BoardProjectsResponseSchema: z.ZodType<BoardProjectsResponse> = z.object({
  generatedAt: IsoTime,
  projects: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      bot: z.string().optional(),
      tasks: z.array(TaskViewSchema),
      updates: z.array(z.object({ id: z.string(), text: z.string(), author: z.string(), at: IsoTime, link: z.string().optional() })),
      prs: z.array(z.object({ ref: z.string(), title: z.string(), url: z.string(), state: z.enum(["abierto", "fusionado", "cerrado"]), updatedAt: IsoTime })),
      events: z.array(BnetEventV1Schema),
      summaries: z.array(z.object({ id: z.string(), title: z.string(), at: IsoTime })),
    }),
  ),
});
