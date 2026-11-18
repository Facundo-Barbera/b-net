import { z } from "zod";
import { IsoTime } from "./machines.ts";

/* ------------------------------------------------------------------ *
 * Projects and deliverables (phase 2). A project groups work that bots
 * produce; a deliverable is a file a bot published into a project.
 * ------------------------------------------------------------------ */

/** URL-safe slug; also the on-disk directory name, so the charset is closed on purpose. */
export const ProjectId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "lowercase slug: a-z, 0-9, '-' (max 63)");
export type ProjectId = z.infer<typeof ProjectId>;

/** Bot names come from the hub's local token file and are stamped as deliverable authors. */
export const BotName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,62}$/, "lowercase bot name (max 63)");
export type BotName = z.infer<typeof BotName>;

/** How threads, checkouts and repos are attributed to a project (consumed by the event detection in increment 3). */
export const ProjectGrouping = z
  .object({
    /** T3 project titles that belong to this project. */
    t3ProjectTitles: z.array(z.string().min(1).max(200)).max(50).default([]),
    /** Absolute checkout paths (any machine). */
    paths: z.array(z.string().min(1).max(500)).max(50).default([]),
    /** Git remotes, e.g. "github.com/owner/repo". */
    gitRemotes: z.array(z.string().min(1).max(300)).max(50).default([]),
  })
  .strict();
export type ProjectGrouping = z.infer<typeof ProjectGrouping>;

export const Project = z
  .object({
    id: ProjectId,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000),
    grouping: ProjectGrouping,
    ownerBot: BotName.nullable(),
    createdAt: IsoTime,
  })
  .strict();
export type Project = z.infer<typeof Project>;

/** Body of POST /api/v1/projects. */
export const ProjectInput = z
  .object({
    id: ProjectId,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
    grouping: ProjectGrouping.default({ t3ProjectTitles: [], paths: [], gitRemotes: [] }),
    ownerBot: BotName.nullable().default(null),
  })
  .strict();
export type ProjectInput = z.input<typeof ProjectInput>;

/** Project plus deliverable stats, as returned by GET /api/v1/projects[/:id]. */
export const ProjectSummary = Project.extend({
  deliverableCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  lastDeliverableAt: IsoTime.nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

/** Allow-list of deliverable types. The hub verifies each against the file's bytes, not only its extension. */
export const DeliverableKind = z.enum(["html", "markdown", "text", "pdf", "png", "jpeg", "webp", "svg", "mp4", "webm"]);
export type DeliverableKind = z.infer<typeof DeliverableKind>;

export const DeliverableId = z.uuid();

export const Deliverable = z
  .object({
    id: DeliverableId,
    projectId: ProjectId,
    title: z.string().min(1).max(200),
    /** Sanitized original file name, used for Content-Disposition. */
    filename: z.string().min(1).max(200),
    kind: DeliverableKind,
    mimeType: z.string(),
    sizeBytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    /** Bot that uploaded it; always derived from the bearer token, never from the request body. */
    author: BotName,
    threadId: z.string().max(200).nullable(),
    prUrl: z.url({ protocol: /^https?$/ }).max(500).nullable(),
    createdAt: IsoTime,
  })
  .strict();
export type Deliverable = z.infer<typeof Deliverable>;

/**
 * Query string of POST /api/v1/projects/:id/deliverables. The request body is the raw file
 * (not multipart) so the hub can stream it straight to disk.
 */
export const DeliverableUploadQuery = z
  .object({
    title: z.string().trim().min(1).max(200),
    filename: z.string().min(1).max(200).optional(),
    threadId: z.string().min(1).max(200).optional(),
    prUrl: z.url({ protocol: /^https?$/ }).max(500).optional(),
  })
  .strict();
export type DeliverableUploadQuery = z.infer<typeof DeliverableUploadQuery>;
