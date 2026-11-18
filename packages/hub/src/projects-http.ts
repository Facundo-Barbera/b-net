/**
 * /api/v1/projects/** routes. Auth happens in http.ts before these run: reads arrive already
 * authorized, writes arrive with the bot name taken from the bearer token.
 */
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { DeliverableId, DeliverableUploadQuery, Project, ProjectId, ProjectInput, type Deliverable } from "@b-net/core";
import { DELIVERABLE_MAX_BYTES, DeliverableFiles, MIME_BY_KIND, UploadError, contentResponse, defaultFilename, receiveUpload, sanitizeFilename } from "./deliverables.ts";
import type { ProjectStore } from "./projects-store.ts";
import { error, json } from "./respond.ts";

export interface ProjectsApiDeps {
  store: ProjectStore;
  files: DeliverableFiles;
  quotaBytes: number;
  /** Per-file cap; defaults to 1 GiB, lowered in tests. */
  maxBytes?: number;
  clock?: () => Date;
}

export interface ProjectsApi {
  /** Null when the path is not a projects route. */
  read(req: Request, path: string, q: URLSearchParams): Promise<Response | null>;
  write(req: Request, path: string, q: URLSearchParams, bot: string): Promise<Response | null>;
}

const JSON_BODY_MAX = 64 * 1024;

type Match =
  | { route: "projects" }
  | { route: "project"; projectId: string }
  | { route: "deliverables"; projectId: string }
  | { route: "deliverable" | "content"; projectId: string; deliverableId: string }
  | { route: "invalid" };

const ROUTE_RE = /^\/api\/v1\/projects(?:\/([^/]+)(?:\/(deliverables)(?:\/([^/]+)(?:\/(content))?)?)?)?$/;

export const isProjectsPath = (path: string) => path === "/api/v1/projects" || path.startsWith("/api/v1/projects/");

/** Ids are checked here, before any store or filesystem access, so traversal attempts stop at the router. */
function match(path: string): Match | null {
  if (!isProjectsPath(path)) return null;
  const m = ROUTE_RE.exec(path);
  if (!m) return { route: "invalid" };
  const [, pid, deliv, did, content] = m;
  if (pid === undefined) return { route: "projects" };
  if (!ProjectId.safeParse(pid).success) return { route: "invalid" };
  if (!deliv) return { route: "project", projectId: pid };
  if (did === undefined) return { route: "deliverables", projectId: pid };
  if (!DeliverableId.safeParse(did).success) return { route: "invalid" };
  return { route: content ? "content" : "deliverable", projectId: pid, deliverableId: did };
}

async function readJson(req: Request): Promise<unknown> {
  if (!req.body) throw new UploadError(400, "missing JSON body");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > JSON_BODY_MAX) {
      await reader.cancel();
      throw new UploadError(413, "JSON body too large");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new UploadError(400, "invalid JSON");
  }
}

const firstIssue = (e: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const i = e.issues[0];
  return i ? `${i.path.map(String).join(".") || "body"}: ${i.message}` : "invalid input";
};

export function createProjectsApi(deps: ProjectsApiDeps): ProjectsApi {
  const clock = deps.clock ?? (() => new Date());
  const maxBytes = deps.maxBytes ?? DELIVERABLE_MAX_BYTES;

  async function read(req: Request, path: string, q: URLSearchParams): Promise<Response | null> {
    const m = match(path);
    if (!m) return null;
    switch (m.route) {
      case "invalid":
        return error(404, "not found");
      case "projects":
        return json({ projects: deps.store.listProjects() });
      case "project": {
        const p = deps.store.getProject(m.projectId);
        return p ? json(p) : error(404, "project not found");
      }
      case "deliverables":
        if (!deps.store.getProject(m.projectId)) return error(404, "project not found");
        return json({ deliverables: deps.store.listDeliverables(m.projectId) });
      case "deliverable": {
        const d = deps.store.getDeliverable(m.projectId, m.deliverableId);
        return d ? json(d) : error(404, "deliverable not found");
      }
      case "content": {
        const d = deps.store.getDeliverable(m.projectId, m.deliverableId);
        if (!d) return error(404, "deliverable not found");
        return contentResponse(d, deps.files.pathFor(d.projectId, d.id), req, q.get("download") === "1");
      }
    }
  }

  async function write(req: Request, path: string, q: URLSearchParams, bot: string): Promise<Response | null> {
    const m = match(path);
    if (!m) return null;
    try {
      if (m.route === "projects") return await createProject(req);
      if (m.route === "deliverables") return await upload(req, m.projectId, q, bot);
      return m.route === "invalid" ? error(404, "not found") : error(405, "method not allowed");
    } catch (e) {
      if (e instanceof UploadError) return error(e.status, e.message);
      throw e;
    }
  }

  async function createProject(req: Request): Promise<Response> {
    const parsed = ProjectInput.safeParse(await readJson(req));
    if (!parsed.success) return error(400, firstIssue(parsed.error));
    const project: Project = { ...parsed.data, createdAt: clock().toISOString() };
    if (!deps.store.createProject(project)) return error(409, "project id already exists");
    return json(project, 201);
  }

  async function upload(req: Request, projectId: string, q: URLSearchParams, bot: string): Promise<Response> {
    if (!deps.store.getProject(projectId)) return error(404, "project not found");
    const query = DeliverableUploadQuery.safeParse(Object.fromEntries(q));
    if (!query.success) return error(400, firstIssue(query.error));
    if (!req.body) return error(400, "empty body");

    const remainingQuota = () => deps.quotaBytes - deps.store.totalBytes();
    // Reject before reading a byte when the client announces the size.
    const declared = Number(req.headers.get("content-length") ?? NaN);
    if (Number.isFinite(declared)) {
      if (declared > maxBytes) return error(413, `deliverable exceeds the ${maxBytes} byte limit`);
      if (declared > remainingQuota()) return error(507, "deliverables storage quota exceeded; delete old deliverables or raise HUB_DELIVERABLES_QUOTA_GB");
    }

    const filename = sanitizeFilename(query.data.filename);
    const received = await receiveUpload(req.body, deps.files.tmpDir, filename, { maxBytes, remainingQuota: remainingQuota() });
    const id = randomUUID();
    const deliverable: Deliverable = {
      id,
      projectId,
      title: query.data.title,
      filename: filename ?? defaultFilename(id, received.kind),
      kind: received.kind,
      mimeType: MIME_BY_KIND[received.kind],
      sizeBytes: received.sizeBytes,
      sha256: received.sha256,
      author: bot,
      threadId: query.data.threadId ?? null,
      prUrl: query.data.prUrl ?? null,
      createdAt: clock().toISOString(),
    };

    let dest: string | null = null;
    try {
      dest = await deps.files.commit(received.tmpPath, projectId, id);
      // Concurrent uploads only checked the quota against committed rows while streaming;
      // this check and the insert run without an await in between, so they cannot interleave.
      if (received.sizeBytes > remainingQuota()) throw new UploadError(507, "deliverables storage quota exceeded; delete old deliverables or raise HUB_DELIVERABLES_QUOTA_GB");
      deps.store.addDeliverable(deliverable);
    } catch (e) {
      await rm(dest ?? received.tmpPath, { force: true });
      throw e;
    }
    return json(deliverable, 201);
  }

  return { read, write };
}
