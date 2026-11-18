import { z } from "zod";
import { IsoTime } from "./machines.ts";
import { BotName, ProjectId } from "./projects.ts";

/* ------------------------------------------------------------------ *
 * Hub events (type only). Detection and webhook delivery land in
 * phase 2 increment 3; nothing emits or sends these yet.
 * ------------------------------------------------------------------ */

const EventBase = z.object({
  id: z.uuid(),
  at: IsoTime,
  /** Null when the thread could not be attributed to a project. */
  projectId: ProjectId.nullable(),
  title: z.string().max(200),
});

const ThreadRef = { machineId: z.string(), threadId: z.string() };

export const HubEvent = z.discriminatedUnion("type", [
  EventBase.extend({ type: z.literal("thread_completed"), ...ThreadRef }).strict(),
  EventBase.extend({ type: z.literal("pending_input"), ...ThreadRef }).strict(),
  EventBase.extend({ type: z.literal("blocked"), ...ThreadRef, reason: z.string().max(500) }).strict(),
  EventBase.extend({ type: z.literal("manual"), by: BotName, message: z.string().max(2000) }).strict(),
]);
export type HubEvent = z.infer<typeof HubEvent>;
export type HubEventType = HubEvent["type"];
