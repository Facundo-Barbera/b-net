/**
 * From a Board event to webhook deliveries. Only a newly posted message in `<slug>/eventos` counts (edits,
 * labels and reactions re-deliver the same message and would duplicate), and only its `bnet.event@1`
 * blocks (thread_done, question, blocked). Two checks keep one project's writers from reaching another
 * project's bot: the block's `project` must be the channel's, and its `bot` must be configured for that
 * project. The delivery goes to that bot's webhook, or to the local test sink when it has none.
 */
import { BNET_EVENT_ID, BNET_EVENT_SCHEMA, BNET_EVENT_VERSION, BnetEventV1Schema, channelKindOf, projectOfChannel, type BnetWebhookBody } from "@b-net/core";
import type { BoardBot } from "./config.ts";
import type { OutboxItem } from "./outbox.ts";

/** What this module reads of a Board event (BoardEventView): structural, so tests need no Board. */
export interface EventLike {
  type: string;
  message?: {
    id: string;
    channel: string;
    createdAt: string;
    blocks: ReadonlyArray<{ schema: string; version: number; data: Record<string, unknown> }>;
  };
}

/** The text filter Board's tail and poll use to see only messages that can carry the block. */
export const BNET_EVENT_TEXT = BNET_EVENT_ID;

export interface Routing {
  bots: readonly BoardBot[];
  defaultWebhookUrl: string;
}

/** The project's bot named `bot`, if it is configured for that project explicitly ("*" publishers get none). */
export function webhookFor(project: string, bot: string, routing: Routing): { bot: string; url: string } | null {
  const b = routing.bots.find((x) => x.name === bot && x.projects.includes(project));
  return b ? { bot: b.name, url: b.webhook?.url ?? routing.defaultWebhookUrl } : null;
}

export function deliveriesFor(event: EventLike, routing: Routing): OutboxItem[] {
  const m = event.message;
  if (event.type !== "message.posted" || !m || channelKindOf(m.channel) !== "eventos") return [];
  const project = projectOfChannel(m.channel);
  if (!project) return [];
  const out: OutboxItem[] = [];
  m.blocks.forEach((b, index) => {
    if (b.schema !== BNET_EVENT_SCHEMA || b.version !== BNET_EVENT_VERSION) return;
    const parsed = BnetEventV1Schema.safeParse(b.data);
    if (!parsed.success || parsed.data.project !== project) return;
    const target = webhookFor(project, parsed.data.bot, routing);
    if (!target) return;
    const id = `${m.id}:${index}`;
    const body: BnetWebhookBody = { id, board: { message: m.id, channel: m.channel, at: m.createdAt }, event: parsed.data };
    out.push({ id, bot: target.bot, url: target.url, body: JSON.stringify(body) });
  });
  return out;
}
