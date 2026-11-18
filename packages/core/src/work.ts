/**
 * Pure derivation of the work home (WorkSnapshot) from data the hub already has: T3 threads (agents and
 * exporters), source health and the projects/deliverables store. Lives in core so the hub endpoint and the
 * canonical fixture run the same code. No I/O, deterministic for a given `now`.
 */
import type { SourceHealth } from "./contracts/api.ts";
import type { Deliverable, ProjectSummary } from "./contracts/projects.ts";
import type { T3ThreadView } from "./contracts/threads.ts";
import type { LinkedPr, ProjectRef, ProjectWork, WorkItem, WorkSnapshot, WorkSourceState, WorkThread } from "./contracts/work.ts";

/** "Listo hace poco" window: completed runs, failures, deliverables and PR links younger than this. */
export const WORK_RECENT_HOURS = 72;
/** Cap of the done lane; the project detail has the full lists. */
export const WORK_DONE_LIMIT = 40;

export const NO_PROJECT_KEY = "none";
const T3_PREFIX = "t3:";

/** One registered project with every deliverable it has (newest first, as ProjectStore returns them). */
export interface ProjectCatalogEntry {
  project: ProjectSummary;
  deliverables: Deliverable[];
}

export interface WorkInputs {
  now: Date | number;
  threads: readonly T3ThreadView[];
  sources: readonly SourceHealth[];
  /** null when the hub has no projects storage (HUB_DATA_DIR unset). */
  catalog: readonly ProjectCatalogEntry[] | null;
}

/**
 * Deep link that opens a thread in T3 Code. Only the machine running that T3 can resolve it, so the
 * machine travels along; the UI also prints it next to the link.
 */
export function t3ThreadHref(machineId: string, threadId: string): string {
  return `t3-thread://${encodeURIComponent(threadId)}?machine=${encodeURIComponent(machineId)}`;
}

/** In-app route of a project, and of one of its deliverables. */
export function projectHref(key: string, deliverableId?: string): string {
  const base = `#/projects/${encodeURIComponent(key)}`;
  return deliverableId ? `${base}/d/${deliverableId}` : base;
}

function sourceState(sources: readonly SourceHealth[], kind: SourceHealth["source"]): WorkSourceState {
  const entries = sources.filter((s) => s.source === kind);
  if (entries.length === 0) return "missing";
  return entries.some((s) => s.ok) ? "ok" : "failing";
}

const norm = (s: string) => s.trim().toLowerCase();
const ms = (iso: string) => Date.parse(iso);
const latest = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : ms(a) >= ms(b) ? a : b);

/**
 * Attribution, in order: the project's grouping.t3ProjectTitles; a T3 project title equal to the project's
 * id or name (case-insensitive); a deliverable of the project that names the thread. Otherwise the T3
 * project title itself becomes an unregistered project, and threads without one go to "none".
 */
function attribute(threads: readonly T3ThreadView[], catalog: readonly ProjectCatalogEntry[]) {
  const byTitle = new Map<string, ProjectRef>();
  const byThread = new Map<string, ProjectRef>();
  for (const { project: p, deliverables } of catalog) {
    const ref: ProjectRef = { key: p.id, projectId: p.id, name: p.name };
    for (const t of [p.id, p.name]) if (!byTitle.has(norm(t))) byTitle.set(norm(t), ref);
    for (const d of deliverables) if (d.threadId && !byThread.has(d.threadId)) byThread.set(d.threadId, ref);
  }
  // Explicit grouping wins over a name coincidence with another project.
  for (const { project: p } of catalog) {
    for (const t of p.grouping.t3ProjectTitles) byTitle.set(norm(t), { key: p.id, projectId: p.id, name: p.name });
  }
  const refOf = (t: T3ThreadView): ProjectRef => {
    const title = t.projectTitle?.trim() || null;
    const hit = (title && byTitle.get(norm(title))) || byThread.get(t.id);
    if (hit) return hit;
    if (title) return { key: `${T3_PREFIX}${title}`.slice(0, 220), projectId: null, name: title.slice(0, 200) };
    return { key: NO_PROJECT_KEY, projectId: null, name: "Sin proyecto" };
  };
  return new Map(threads.map((t) => [t.id + "@" + t.machineId, refOf(t)]));
}

const threadDetail = (t: T3ThreadView) => [t.provider, t.model, t.branch].filter(Boolean).join(" · ") || null;

export function deriveWork({ now, threads: all, sources, catalog }: WorkInputs): WorkSnapshot {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const recentFrom = nowMs - WORK_RECENT_HOURS * 3_600_000;
  const recent = (iso: string) => ms(iso) >= recentFrom;
  const cat = catalog ?? [];

  const threads = all.filter((t) => t.state !== "archived");
  const refs = attribute(threads, cat);
  const refFor = (t: T3ThreadView) => refs.get(t.id + "@" + t.machineId)!;

  const threadItem = (t: T3ThreadView, kind: WorkItem["kind"]): WorkItem => ({
    id: `${kind}:${t.machineId}:${t.id}`,
    kind,
    project: refFor(t),
    title: t.title.trim().slice(0, 300) || "(hilo sin título)",
    at: t.updatedAt,
    since: kind === "running" ? t.runningSince : null,
    machineId: t.machineId,
    detail: threadDetail(t),
    link: { kind: "thread", href: t3ThreadHref(t.machineId, t.id) },
  });

  const needsInput = threads.filter((t) => t.state === "waiting").sort((a, b) => ms(a.updatedAt) - ms(b.updatedAt));
  const failed = threads
    .filter((t) => (t.state === "idle" || t.state === "dormant") && (t.lastRunStatus === "failed" || t.lastRunStatus === "interrupted") && recent(t.updatedAt))
    .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  const waiting = [...needsInput.map((t) => threadItem(t, "needs_input")), ...failed.map((t) => threadItem(t, "run_failed"))];

  const running = threads
    .filter((t) => t.state === "active")
    .sort((a, b) => ms(a.runningSince ?? a.updatedAt) - ms(b.runningSince ?? b.updatedAt))
    .map((t) => threadItem(t, "running"));

  const done: WorkItem[] = threads
    .filter((t) => (t.state === "idle" || t.state === "dormant") && t.lastRunStatus === "completed" && recent(t.updatedAt))
    .map((t) => threadItem(t, "completed"));

  const prs = new Map<string, LinkedPr>();
  for (const { project: p, deliverables } of cat) {
    const ref: ProjectRef = { key: p.id, projectId: p.id, name: p.name };
    for (const d of deliverables) {
      if (recent(d.createdAt)) {
        done.push({
          id: `deliverable:${d.id}`,
          kind: "deliverable",
          project: ref,
          title: d.title,
          at: d.createdAt,
          since: null,
          machineId: null,
          detail: `${d.kind} · ${d.author}`,
          link: { kind: "deliverable", href: projectHref(p.id, d.id) },
        });
      }
      const seen = d.prUrl ? prs.get(d.prUrl) : undefined;
      if (d.prUrl && (!seen || ms(d.createdAt) > ms(seen.lastSeenAt))) {
        prs.set(d.prUrl, { url: d.prUrl, projectKey: p.id, lastSeenAt: d.createdAt, deliverableTitle: d.title });
      }
    }
  }
  const nameOf = new Map(cat.map((c) => [c.project.id, c.project.name]));
  for (const pr of prs.values()) {
    if (!recent(pr.lastSeenAt)) continue;
    done.push({
      id: `pr:${pr.url}`,
      kind: "pr_linked",
      project: { key: pr.projectKey, projectId: pr.projectKey, name: nameOf.get(pr.projectKey) ?? pr.projectKey },
      title: prTitle(pr.url),
      at: pr.lastSeenAt,
      since: null,
      machineId: null,
      detail: pr.deliverableTitle,
      link: { kind: "pr", href: pr.url },
    });
  }
  done.sort((a, b) => ms(b.at) - ms(a.at) || a.id.localeCompare(b.id));

  // Per-project rollup.
  const rows = new Map<string, ProjectWork>();
  const row = (ref: ProjectRef, registered: boolean, description = ""): ProjectWork => {
    let r = rows.get(ref.key);
    if (!r) {
      r = { ref, registered, description, counts: { waiting: 0, running: 0, threads: 0, prs: 0, deliverables: 0 }, lastActivityAt: null };
      rows.set(ref.key, r);
    }
    return r;
  };
  for (const { project: p, deliverables } of cat) {
    const r = row({ key: p.id, projectId: p.id, name: p.name }, true, p.description);
    r.counts.deliverables = deliverables.length;
    r.counts.prs = new Set(deliverables.map((d) => d.prUrl).filter(Boolean)).size;
    r.lastActivityAt = p.lastDeliverableAt;
  }
  for (const t of threads) {
    const r = row(refFor(t), false);
    r.counts.threads++;
    r.lastActivityAt = latest(r.lastActivityAt, t.updatedAt);
  }
  for (const i of waiting) row(i.project, false).counts.waiting++;
  for (const i of running) row(i.project, false).counts.running++;

  const rank = (p: ProjectWork) => (p.registered ? 0 : p.ref.key === NO_PROJECT_KEY ? 2 : 1);
  const projects = [...rows.values()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.lastActivityAt ? ms(b.lastActivityAt) : 0) - (a.lastActivityAt ? ms(a.lastActivityAt) : 0) ||
      a.ref.name.localeCompare(b.ref.name),
  );

  const workThreads: WorkThread[] = threads
    .map((t) => ({ ...t, projectKey: refFor(t).key }))
    .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));

  return {
    generatedAt: new Date(nowMs).toISOString(),
    sources: {
      threads: sourceState(sources, "t3"),
      projects: catalog === null ? "missing" : "ok",
      pullRequests: "missing",
      git: "missing",
      tasks: "missing",
    },
    waiting,
    running,
    done: done.slice(0, WORK_DONE_LIMIT),
    projects,
    threads: workThreads,
    prs: [...prs.values()].sort((a, b) => ms(b.lastSeenAt) - ms(a.lastSeenAt)),
  };
}

/** "owner/repo#123" from a GitHub PR URL; the URL itself otherwise. */
export function prTitle(url: string): string {
  const m = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return m ? `${m[1]}#${m[2]}` : url.slice(0, 300);
}
