import { z } from "zod";
import { IsoTime } from "./machines.ts";
import { ProjectId } from "./projects.ts";
import { T3ThreadView } from "./threads.ts";

/* ------------------------------------------------------------------ *
 * Work home (GET /api/v1/work): what needs Facundo, what is running and
 * what finished recently, grouped by project. Derived by the hub from
 * the T3 threads it already pulls and the projects/deliverables store;
 * see deriveWork() in ../work.ts.
 * ------------------------------------------------------------------ */

/**
 * State of each source the work view depends on. "missing" = not connected to the hub, so the UI says
 * what to connect instead of showing an empty list that looks like "nothing happened".
 * pullRequests, git and tasks have no source yet and are always "missing" for now.
 */
export const WorkSourceState = z.enum(["ok", "failing", "missing"]);
export type WorkSourceState = z.infer<typeof WorkSourceState>;

export const WorkSources = z
  .object({
    threads: WorkSourceState,
    projects: WorkSourceState,
    pullRequests: WorkSourceState,
    git: WorkSourceState,
    tasks: WorkSourceState,
  })
  .strict();
export type WorkSources = z.infer<typeof WorkSources>;

/**
 * Where a piece of work belongs. `key` is stable and URL-safe after encoding:
 * - a registered project: its id (`projectId` set)
 * - a T3 project title no registered project claims: "t3:<title>" (`projectId` null)
 * - nothing to attribute it to: "none"
 */
export const ProjectRef = z
  .object({
    key: z.string().min(1).max(220),
    projectId: ProjectId.nullable(),
    name: z.string().min(1).max(200),
  })
  .strict();
export type ProjectRef = z.infer<typeof ProjectRef>;

/**
 * Kinds of work events:
 * - needs_input:  T3 thread waiting on the human (approval, question or proposed plan)
 * - run_failed:   the last run of a thread failed or was interrupted (recently)
 * - running:      a run is in progress
 * - completed:    a run finished (recently)
 * - deliverable:  a bot published a deliverable (recently)
 * - pr_linked:    a deliverable references a pull request (state unknown until GitHub is connected)
 */
export const WorkKind = z.enum(["needs_input", "run_failed", "running", "completed", "deliverable", "pr_linked"]);
export type WorkKind = z.infer<typeof WorkKind>;

export const WorkLink = z
  .object({
    kind: z.enum(["thread", "pr", "deliverable"]),
    /** t3-thread://…, an https PR URL, or an in-app hash route ("#/projects/…"). */
    href: z.string().min(1).max(600),
  })
  .strict();
export type WorkLink = z.infer<typeof WorkLink>;

export const WorkItem = z
  .object({
    /** Unique within one WorkSnapshot (kind + source id). */
    id: z.string().min(1).max(300),
    kind: WorkKind,
    project: ProjectRef,
    title: z.string().min(1).max(300),
    /** When the event happened (thread updatedAt, deliverable createdAt). */
    at: IsoTime,
    /** Start of the current run (running only). */
    since: IsoTime.nullable(),
    machineId: z.string().nullable(),
    /** Short secondary text: provider · model, author bot, branch. */
    detail: z.string().max(300).nullable(),
    link: WorkLink.nullable(),
  })
  .strict();
export type WorkItem = z.infer<typeof WorkItem>;

export const ProjectWork = z
  .object({
    ref: ProjectRef,
    /** Registered in the hub (vs. inferred from a T3 project title). */
    registered: z.boolean(),
    description: z.string().max(2000),
    counts: z
      .object({
        waiting: z.number().int().nonnegative(),
        running: z.number().int().nonnegative(),
        threads: z.number().int().nonnegative(),
        /** Distinct PR URLs referenced by the project's deliverables. */
        prs: z.number().int().nonnegative(),
        deliverables: z.number().int().nonnegative(),
      })
      .strict(),
    lastActivityAt: IsoTime.nullable(),
  })
  .strict();
export type ProjectWork = z.infer<typeof ProjectWork>;

/** A non-archived T3 thread with the project it was attributed to. */
export const WorkThread = T3ThreadView.extend({ projectKey: z.string().min(1).max(220) });
export type WorkThread = z.infer<typeof WorkThread>;

/** PR referenced by a deliverable (the only PR source until GitHub is connected). */
export const LinkedPr = z
  .object({
    url: z.url({ protocol: /^https?$/ }).max(500),
    projectKey: z.string().min(1).max(220),
    /** Most recent deliverable that referenced it. */
    lastSeenAt: IsoTime,
    deliverableTitle: z.string().max(200),
  })
  .strict();
export type LinkedPr = z.infer<typeof LinkedPr>;

export const WorkSnapshot = z
  .object({
    generatedAt: IsoTime,
    sources: WorkSources,
    /** Needs Facundo, most urgent first. */
    waiting: z.array(WorkItem),
    /** Runs in progress, longest-running first. */
    running: z.array(WorkItem),
    /** Finished recently (see WORK_RECENT_HOURS), newest first. */
    done: z.array(WorkItem),
    /** Registered projects, then inferred T3 projects, then "none" if it has threads. */
    projects: z.array(ProjectWork),
    threads: z.array(WorkThread),
    prs: z.array(LinkedPr),
  })
  .strict();
export type WorkSnapshot = z.infer<typeof WorkSnapshot>;
