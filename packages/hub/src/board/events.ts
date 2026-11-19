/**
 * From a Board event to webhook deliveries. Only a newly posted message counts (edits, labels and
 * reactions re-deliver the same message and would duplicate), and only its `bnet.event@1` blocks whose
 * kind is thread_done, question or blocked. The project is the channel's first segment; a block that
 * names another project is dropped, so writing in one project's channel can never reach another
 * project's bot.
 */
import { BNET_EVENT_SCHEMA, BnetEvent, projectOfChannel, type BnetWebhookBody } from "@b-net/core";
import type { BoardBot } from "./config.ts";
import type { OutboxItem } from "./outbox.ts";

/** What this module reads of a Board event (BoardEventView): kept structural so tests need no Board. */
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
export const BNET_EVENT_TEXT = `${BNET_EVENT_SCHEMA.name}@${BNET_EVENT_SCHEMA.version}`;

export interface Routing {
  bots: readonly BoardBot[];
  defaultWebhookUrl: string;
}

/** Bots that get a project's events: those listing it explicitly ("*" publishers get none). */
export function botsForProject(project: string, routing: Routing): Array<{ bot: string; url: string }> {
  return routing.bots.filter((b) => b.projects.includes(project)).map((b) => ({ bot: b.name, url: b.webhook?.url ?? routing.defaultWebhookUrl }));
}

export function deliveriesFor(event: EventLike, routing: Routing): OutboxItem[] {
  const m = event.message;
  if (event.type !== "message.posted" || !m) return [];
  const project = projectOfChannel(m.channel);
  if (!project) return [];
  const targets = botsForProject(project, routing);
  if (targets.length === 0) return [];
  const out: OutboxItem[] = [];
  m.blocks.forEach((b, index) => {
    if (b.schema !== BNET_EVENT_SCHEMA.name || b.version !== BNET_EVENT_SCHEMA.version) return;
    const parsed = BnetEvent.safeParse(b.data);
    if (!parsed.success || parsed.data.project !== project) return;
    const id = `${m.id}:${index}`;
    const body: BnetWebhookBody = { id, board: { message: m.id, channel: m.channel, at: m.createdAt }, event: parsed.data };
    const json = JSON.stringify(body);
    for (const t of targets) out.push({ id, bot: t.bot, url: t.url, body: json });
  });
  return out;
}
