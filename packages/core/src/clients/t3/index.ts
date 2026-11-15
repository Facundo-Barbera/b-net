/**
 * Read-only T3 client (orchestration v2 projections).
 *
 * Opens `~/.t3/userdata/statev2.sqlite` read-only and derives `T3ThreadView[]`.
 * Privacy: only thread METADATA is read (title, state, model, branch, timestamps).
 * No message / activity / diff tables are ever queried, and `payload_json` is only
 * probed for a handful of known keys.
 *
 * Version drift: every table and column is introspected first. A missing optional
 * table/column degrades the result (see `health.degraded`); a missing required one
 * returns `[]` with `health.ok = false`. This module never throws for DB problems.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { T3ThreadView, ThreadState } from "../../contracts/threads.ts";

export type T3HealthReason = "db_not_found" | "open_failed" | "schema_drift" | "query_failed";

export interface T3Health {
  /** true = the thread list could be produced (possibly degraded). */
  ok: boolean;
  reason: T3HealthReason | null;
  detail: string | null;
  /** Optional tables/columns that were missing; state derivation was weaker because of them. */
  degraded: string[];
}

export interface T3ReadResult {
  threads: T3ThreadView[];
  health: T3Health;
}

export interface T3ReadOptions {
  machineId: string;
  /** Defaults to `~/.t3/userdata/statev2.sqlite`. */
  dbPath?: string;
  /** Injectable clock (only used as a fallback for unparseable timestamps). */
  now?: () => Date;
}

export function defaultT3DbPath(home: string = homedir()): string {
  return join(home, ".t3", "userdata", "statev2.sqlite");
}

/* ------------------------------------------------------------------ *
 * Table specs: the ONLY tables/columns this client ever reads.
 * ------------------------------------------------------------------ */
interface TableSpec {
  table: string;
  required: readonly string[];
  optional: readonly string[];
}

const SPECS = {
  threads: {
    table: "orchestration_v2_projection_threads",
    required: ["thread_id", "title", "created_at", "updated_at"],
    optional: [
      "project_id",
      "default_provider",
      "active_provider_thread_id",
      "archived_at",
      "deleted_at",
      "payload_json",
    ],
  },
  projects: {
    table: "projection_projects",
    required: ["project_id", "title"],
    optional: [],
  },
  providerThreads: {
    table: "orchestration_v2_projection_provider_threads",
    required: ["provider_thread_id", "thread_id", "status"],
    optional: ["provider", "updated_at"],
  },
  sessions: {
    table: "orchestration_v2_projection_provider_sessions",
    required: ["thread_id", "status"],
    optional: ["provider", "model", "updated_at"],
  },
  runs: {
    table: "orchestration_v2_projection_runs",
    required: ["thread_id", "ordinal", "status"],
    optional: ["requested_at", "completed_at"],
  },
  requests: {
    table: "orchestration_v2_projection_runtime_requests",
    required: ["thread_id", "status"],
    optional: ["resolved_at", "created_at"],
  },
} as const satisfies Record<string, TableSpec>;

type Row = Record<string, unknown>;

function columnsOf(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare("SELECT name FROM pragma_table_info(?)").all(table) as Row[];
  return new Set(rows.map((r) => String(r["name"])));
}

/** Introspect, then SELECT only the known columns that exist. null = required part missing. */
function selectFor(
  db: DatabaseSync,
  spec: TableSpec,
  degraded: string[],
  tail = "",
): { rows: Row[]; cols: Set<string> } | null {
  const have = columnsOf(db, spec.table);
  if (have.size === 0) return null; // table absent
  const missingRequired = spec.required.filter((c) => !have.has(c));
  if (missingRequired.length > 0) return null;
  for (const c of spec.optional) if (!have.has(c)) degraded.push(`${spec.table}.${c}`);
  const cols = [...spec.required, ...spec.optional.filter((c) => have.has(c))];
  // Identifiers come from the static SPECS above, never from input.
  const sql = `SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM "${spec.table}" ${tail}`;
  return { rows: db.prepare(sql).all() as Row[], cols: new Set(cols) };
}

/* ------------------------------------------------------------------ *
 * Value helpers
 * ------------------------------------------------------------------ */
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Normalize ISO / SQLite datetime / epoch (s or ms) to an ISO-8601 UTC string. */
export function toIso(v: unknown): string | null {
  let d: Date | null = null;
  if (typeof v === "number" && Number.isFinite(v)) {
    d = new Date(v < 1e11 ? v * 1000 : v);
  } else if (typeof v === "string" && v.length > 0) {
    // "YYYY-MM-DD HH:MM:SS[.fff]" (SQLite CURRENT_TIMESTAMP) has no zone: it is UTC.
    const s = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(v) ? `${v.replace(" ", "T")}Z` : v;
    d = new Date(s);
  }
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

interface PayloadMeta {
  model: string | null;
  branch: string | null;
  parentThreadId: string | null;
}

/** Extracts ONLY known metadata keys; everything else in the payload is ignored. */
function parsePayload(json: unknown): PayloadMeta {
  const empty: PayloadMeta = { model: null, branch: null, parentThreadId: null };
  if (typeof json !== "string" || json.length === 0) return empty;
  try {
    const p = JSON.parse(json) as Record<string, unknown> | null;
    if (!p || typeof p !== "object") return empty;
    const ms = p["modelSelection"] as Record<string, unknown> | undefined;
    const lineage = p["lineage"] as Record<string, unknown> | undefined;
    return {
      model: str(ms?.["model"]),
      branch: str(p["branch"]),
      parentThreadId: str(lineage?.["parentThreadId"]),
    };
  } catch {
    return empty;
  }
}

/** Runtime-request statuses that mean "no longer waiting on the human". */
const RESOLVED_REQUEST_STATUSES = new Set([
  "resolved",
  "answered",
  "approved",
  "denied",
  "declined",
  "rejected",
  "completed",
  "cancelled",
  "canceled",
  "expired",
  "failed",
  "dismissed",
]);

function isPendingRequest(row: Row): boolean {
  if (str(row["resolved_at"])) return false;
  const status = str(row["status"])?.toLowerCase() ?? "";
  return !RESOLVED_REQUEST_STATUSES.has(status);
}

type RunStatus = NonNullable<T3ThreadView["lastRunStatus"]>;
const RUN_STATUSES: readonly string[] = ["running", "completed", "failed", "interrupted", "cancelled"];

/** Signals needed to derive a thread's state. Exported for direct unit testing. */
export interface StateSignals {
  archived: boolean;
  pendingRequest: boolean;
  lastRunStatus: RunStatus | null;
  providerThreadStatus: string | null;
  sessionStatus: string | null;
}

/**
 * Priority: archived > waiting > active > idle > dormant.
 * `waiting` outranks `active`: a running run blocked on an approval is waiting for the human.
 */
export function deriveThreadState(s: StateSignals): ThreadState {
  if (s.archived) return "archived";
  if (s.pendingRequest) return "waiting";
  if (s.lastRunStatus === "running" || s.providerThreadStatus === "active") return "active";
  if (s.sessionStatus === "ready") return "idle";
  return "dormant";
}

/* ------------------------------------------------------------------ *
 * Main reader
 * ------------------------------------------------------------------ */

/** Derives thread views from an already-open database (used by tests with in-memory DBs). */
export function readT3ThreadsFromDb(db: DatabaseSync, opts: Pick<T3ReadOptions, "machineId" | "now">): T3ReadResult {
  const now = opts.now ?? (() => new Date());
  const degraded: string[] = [];
  try {
    const threadsQ = selectFor(db, SPECS.threads, degraded, "");
    if (!threadsQ) {
      return fail("schema_drift", `missing table or required columns: ${SPECS.threads.table}`, degraded);
    }
    const hasDeleted = threadsQ.cols.has("deleted_at");
    const threadRows = threadsQ.rows.filter((r) => !hasDeleted || !str(r["deleted_at"]));

    const projects = new Map<string, string>();
    const projQ = selectFor(db, SPECS.projects, degraded);
    if (projQ) for (const r of projQ.rows) projects.set(String(r["project_id"]), String(r["title"] ?? ""));
    else degraded.push(SPECS.projects.table);

    // provider threads: remember each thread's active one, plus any with status "active".
    const providerById = new Map<string, Row>();
    const activeProviderByThread = new Map<string, Row>();
    const ptQ = selectFor(db, SPECS.providerThreads, degraded);
    if (ptQ) {
      for (const r of ptQ.rows) {
        providerById.set(String(r["provider_thread_id"]), r);
        if (r["status"] === "active") activeProviderByThread.set(String(r["thread_id"]), r);
      }
    } else degraded.push(SPECS.providerThreads.table);

    // Latest session per thread (by updated_at, then insertion order).
    const sessionByThread = new Map<string, Row>();
    const sesQ = selectFor(db, SPECS.sessions, degraded);
    if (sesQ) {
      for (const r of sesQ.rows) {
        const tid = String(r["thread_id"]);
        const prev = sessionByThread.get(tid);
        if (!prev || (toIso(r["updated_at"]) ?? "") >= (toIso(prev["updated_at"]) ?? "")) sessionByThread.set(tid, r);
      }
    } else degraded.push(SPECS.sessions.table);

    // Latest run per thread (highest ordinal).
    const lastRunByThread = new Map<string, Row>();
    const runQ = selectFor(db, SPECS.runs, degraded);
    if (runQ) {
      for (const r of runQ.rows) {
        const tid = String(r["thread_id"]);
        const prev = lastRunByThread.get(tid);
        if (!prev || Number(r["ordinal"]) >= Number(prev["ordinal"])) lastRunByThread.set(tid, r);
      }
    } else degraded.push(SPECS.runs.table);

    const pending = new Set<string>();
    const reqQ = selectFor(db, SPECS.requests, degraded);
    if (reqQ) {
      for (const r of reqQ.rows) if (isPendingRequest(r)) pending.add(String(r["thread_id"]));
    } else degraded.push(SPECS.requests.table);

    const threads: T3ThreadView[] = threadRows.map((r) => {
      const id = String(r["thread_id"]);
      const meta = parsePayload(r["payload_json"]);
      const run = lastRunByThread.get(id) ?? null;
      const runStatusRaw = run ? str(run["status"]) : null;
      const lastRunStatus = runStatusRaw && RUN_STATUSES.includes(runStatusRaw) ? (runStatusRaw as RunStatus) : null;

      const activeId = str(r["active_provider_thread_id"]);
      const declared = activeId ? providerById.get(activeId) : undefined;
      const provThread = activeProviderByThread.get(id) ?? declared ?? null;
      const session = sessionByThread.get(id) ?? null;

      const state = deriveThreadState({
        archived: Boolean(str(r["archived_at"])),
        pendingRequest: pending.has(id),
        lastRunStatus,
        providerThreadStatus: provThread ? str(provThread["status"]) : null,
        sessionStatus: session ? str(session["status"]) : null,
      });

      const updatedAt = toIso(r["updated_at"]);
      const createdAt = toIso(r["created_at"]) ?? updatedAt ?? now().toISOString();
      const projectId = str(r["project_id"]);

      return {
        id,
        machineId: opts.machineId,
        projectTitle: projectId ? (projects.get(projectId) ?? null) : null,
        title: typeof r["title"] === "string" ? (r["title"] as string) : "",
        provider: str(provThread?.["provider"]) ?? str(session?.["provider"]) ?? str(r["default_provider"]),
        model: meta.model ?? str(session?.["model"]),
        state,
        branch: meta.branch,
        createdAt,
        updatedAt: updatedAt ?? createdAt,
        lastRunStatus,
        runningSince: lastRunStatus === "running" ? toIso(run?.["requested_at"]) : null,
        parentThreadId: meta.parentThreadId,
      };
    });

    threads.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    return { threads, health: { ok: true, reason: null, detail: null, degraded } };
  } catch (err) {
    return fail("query_failed", err instanceof Error ? err.message : String(err), degraded);
  }
}

function fail(reason: T3HealthReason, detail: string, degraded: string[] = []): T3ReadResult {
  return { threads: [], health: { ok: false, reason, detail, degraded } };
}

/** Opens the T3 DB read-only, derives the thread list and closes it. Never throws. */
export function readT3Threads(opts: T3ReadOptions): T3ReadResult {
  const path = opts.dbPath ?? defaultT3DbPath();
  if (!existsSync(path)) return fail("db_not_found", "T3 database not found");
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA query_only=ON");
    return readT3ThreadsFromDb(db, opts);
  } catch (err) {
    return fail("open_failed", err instanceof Error ? err.message : String(err));
  } finally {
    try {
      db?.close();
    } catch {
      /* ignore */
    }
  }
}
