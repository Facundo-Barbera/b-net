import { z } from "zod";
import { IsoTime } from "./machines.ts";

/**
 * Thread state as shown in the hub ("sandboxes despiertas o dormidas"):
 * - active:   a run is in progress right now
 * - waiting:  blocked on the human (pending approval / user input / proposed plan)
 * - idle:     provider session loaded and ready, no run in progress
 * - dormant:  no live provider session (stopped / not loaded)
 * - archived: archived in T3 (hidden by default)
 */
export const ThreadState = z.enum(["active", "waiting", "idle", "dormant", "archived"]);
export type ThreadState = z.infer<typeof ThreadState>;

export const T3ThreadView = z.object({
  id: z.string(),
  machineId: z.string(),
  projectTitle: z.string().nullable(),
  title: z.string(),
  /** T3 provider driver, e.g. "claudeAgent", "codex", "cursor". */
  provider: z.string().nullable(),
  model: z.string().nullable(),
  state: ThreadState,
  branch: z.string().nullable(),
  createdAt: IsoTime,
  updatedAt: IsoTime,
  lastRunStatus: z.enum(["running", "completed", "failed", "interrupted", "cancelled"]).nullable(),
  /** When the current run started (only for active). */
  runningSince: IsoTime.nullable(),
  /** Parent thread id when this is a child/subagent thread. */
  parentThreadId: z.string().nullable(),
});
export type T3ThreadView = z.infer<typeof T3ThreadView>;
