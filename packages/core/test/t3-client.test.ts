import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AgentThreads } from "../src/contracts/api.ts";
import {
  defaultT3DbPath,
  deriveThreadState,
  readT3Threads,
  readT3ThreadsFromDb,
  toIso,
} from "../src/clients/t3/index.ts";

/* Fixture DB: only the needed columns, FAKE rows. */
const SCHEMA = `
CREATE TABLE orchestration_v2_projection_threads (
  thread_id TEXT, project_id TEXT, title TEXT, default_provider TEXT, active_provider_thread_id TEXT,
  created_at TEXT, updated_at TEXT, archived_at TEXT, deleted_at TEXT, payload_json TEXT);
CREATE TABLE projection_projects (project_id TEXT, title TEXT, workspace_root TEXT, deleted_at TEXT);
CREATE TABLE orchestration_v2_projection_provider_threads (
  provider_thread_id TEXT, thread_id TEXT, provider TEXT, provider_session_id TEXT, status TEXT, updated_at TEXT);
CREATE TABLE orchestration_v2_projection_provider_sessions (
  provider_session_id TEXT, thread_id TEXT, provider TEXT, status TEXT, model TEXT, updated_at TEXT);
CREATE TABLE orchestration_v2_projection_runs (
  run_id TEXT, thread_id TEXT, ordinal INTEGER, provider TEXT, status TEXT, requested_at TEXT, completed_at TEXT);
CREATE TABLE orchestration_v2_projection_runtime_requests (
  runtime_request_id TEXT, thread_id TEXT, kind TEXT, status TEXT, created_at TEXT, resolved_at TEXT);
-- never read by the client; used to prove message text does not leak
CREATE TABLE orchestration_v2_projection_messages (message_id TEXT, thread_id TEXT, text TEXT);
`;

const SECRET_TEXT = "SECRET-MESSAGE-TEXT-DO-NOT-LEAK";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  db.prepare("INSERT INTO projection_projects VALUES (?,?,?,?)").run("p1", "demo-project", "/fake/ws", null);
  db.prepare("INSERT INTO orchestration_v2_projection_messages VALUES (?,?,?)").run("m1", "t-active", SECRET_TEXT);

  const addThread = (
    id: string,
    over: Partial<{ archived: string | null; deleted: string | null; payload: object; active: string | null }> = {},
  ) =>
    db
      .prepare("INSERT INTO orchestration_v2_projection_threads VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(
        id,
        "p1",
        `Title ${id}`,
        "claudeAgent",
        over.active ?? null,
        "2026-01-01T10:00:00.000Z",
        "2026-01-01T11:00:00.000Z",
        over.archived ?? null,
        over.deleted ?? null,
        JSON.stringify({
          modelSelection: { model: "fake-model-1" },
          branch: "feat/x",
          lineage: { parentThreadId: id === "t-child" ? "t-active" : null },
          note: SECRET_TEXT,
          ...over.payload,
        }),
      );
  const addRun = (id: string, thread: string, ordinal: number, status: string, at = "2026-01-01T10:30:00.000Z") =>
    db.prepare("INSERT INTO orchestration_v2_projection_runs VALUES (?,?,?,?,?,?,?)").run(id, thread, ordinal, "claudeAgent", status, at, null);
  const addSession = (thread: string, status: string, model: string | null = "session-model") =>
    db
      .prepare("INSERT INTO orchestration_v2_projection_provider_sessions VALUES (?,?,?,?,?,?)")
      .run(`s-${thread}`, thread, "claudeAgent", status, model, "2026-01-01T10:00:00.000Z");
  const addPT = (id: string, thread: string, status: string) =>
    db
      .prepare("INSERT INTO orchestration_v2_projection_provider_threads VALUES (?,?,?,?,?,?)")
      .run(id, thread, "claudeAgent", `s-${thread}`, status, "2026-01-01T10:00:00.000Z");

  // active: latest run running (an older completed run must not matter)
  addThread("t-active", { active: "pt-active" });
  addRun("r1", "t-active", 1, "completed");
  addRun("r2", "t-active", 2, "running", "2026-01-01T10:45:00.000Z");
  addPT("pt-active", "t-active", "idle");
  addSession("t-active", "ready");

  // active via provider thread status only
  addThread("t-pt-active", { active: "pt-2" });
  addPT("pt-2", "t-pt-active", "active");
  addSession("t-pt-active", "ready");

  // waiting: running run + pending request
  addThread("t-waiting");
  addRun("r3", "t-waiting", 1, "running");
  db.prepare("INSERT INTO orchestration_v2_projection_runtime_requests VALUES (?,?,?,?,?,?)").run("rq1", "t-waiting", "approval", "pending", "2026-01-01T10:31:00.000Z", null);
  // a resolved request must NOT make a thread waiting
  addThread("t-idle");
  addRun("r4", "t-idle", 1, "completed");
  addSession("t-idle", "ready");
  db.prepare("INSERT INTO orchestration_v2_projection_runtime_requests VALUES (?,?,?,?,?,?)").run("rq2", "t-idle", "approval", "approved", "2026-01-01T10:31:00.000Z", "2026-01-01T10:32:00.000Z");

  // dormant: stopped session, completed run
  addThread("t-dormant");
  addRun("r5", "t-dormant", 1, "failed");
  addSession("t-dormant", "stopped");
  // dormant: nothing at all
  addThread("t-bare");

  addThread("t-archived", { archived: "2026-01-02T00:00:00.000Z" });
  addRun("r6", "t-archived", 1, "running");
  addThread("t-deleted", { deleted: "2026-01-02T00:00:00.000Z" });
  addThread("t-child");
  return db;
}

const byId = (r: ReturnType<typeof readT3ThreadsFromDb>, id: string) => r.threads.find((t) => t.id === id)!;

describe("T3 client: state derivation", () => {
  const res = readT3ThreadsFromDb(makeDb(), { machineId: "fhub-test" });

  it("is healthy and excludes deleted threads", () => {
    expect(res.health).toMatchObject({ ok: true, reason: null, degraded: [] });
    expect(res.threads.map((t) => t.id)).not.toContain("t-deleted");
    expect(res.threads).toHaveLength(8);
  });

  it("active: latest run running", () => {
    const t = byId(res, "t-active");
    expect(t.state).toBe("active");
    expect(t.lastRunStatus).toBe("running");
    expect(t.runningSince).toBe("2026-01-01T10:45:00.000Z");
  });

  it("active: provider thread active without a running run", () => {
    const t = byId(res, "t-pt-active");
    expect(t.state).toBe("active");
    expect(t.runningSince).toBeNull();
  });

  it("waiting: unresolved runtime request outranks running", () => {
    expect(byId(res, "t-waiting").state).toBe("waiting");
  });

  it("idle: session ready and no pending request (resolved request ignored)", () => {
    expect(byId(res, "t-idle").state).toBe("idle");
  });

  it("dormant: stopped session, or no session at all", () => {
    expect(byId(res, "t-dormant").state).toBe("dormant");
    expect(byId(res, "t-bare").state).toBe("dormant");
    expect(byId(res, "t-dormant").lastRunStatus).toBe("failed");
  });

  it("archived wins over everything", () => {
    expect(byId(res, "t-archived").state).toBe("archived");
  });

  it("fills metadata: project, provider, model, branch, parent, machine", () => {
    const t = byId(res, "t-child");
    expect(t).toMatchObject({
      machineId: "fhub-test",
      projectTitle: "demo-project",
      provider: "claudeAgent",
      model: "fake-model-1",
      branch: "feat/x",
      parentThreadId: "t-active",
      createdAt: "2026-01-01T10:00:00.000Z",
    });
  });

  it("falls back to the session model when the payload has none", () => {
    const db = makeDb();
    db.prepare(
      "UPDATE orchestration_v2_projection_threads SET payload_json = '{}' WHERE thread_id = 't-idle'",
    ).run();
    const r = readT3ThreadsFromDb(db, { machineId: "m" });
    expect(byId(r, "t-idle").model).toBe("session-model");
    expect(byId(r, "t-idle").branch).toBeNull();
  });

  it("output validates against the AgentThreads contract and never carries message text", () => {
    expect(AgentThreads.safeParse({ threads: res.threads }).success).toBe(true);
    expect(JSON.stringify(res)).not.toContain(SECRET_TEXT);
  });

  it("deriveThreadState priority table", () => {
    const base = { archived: false, pendingRequest: false, lastRunStatus: null, providerThreadStatus: null, sessionStatus: null };
    expect(deriveThreadState(base)).toBe("dormant");
    expect(deriveThreadState({ ...base, sessionStatus: "not_loaded" })).toBe("dormant");
    expect(deriveThreadState({ ...base, sessionStatus: "ready" })).toBe("idle");
    expect(deriveThreadState({ ...base, sessionStatus: "ready", providerThreadStatus: "active" })).toBe("active");
    expect(deriveThreadState({ ...base, lastRunStatus: "running", pendingRequest: true })).toBe("waiting");
    expect(deriveThreadState({ ...base, lastRunStatus: "running", pendingRequest: true, archived: true })).toBe("archived");
  });
});

describe("T3 client: version drift robustness", () => {
  it("missing required table -> [] + health flag, no throw", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE unrelated (x TEXT)");
    const r = readT3ThreadsFromDb(db, { machineId: "m" });
    expect(r.threads).toEqual([]);
    expect(r.health).toMatchObject({ ok: false, reason: "schema_drift" });
  });

  it("missing required column on the threads table -> schema_drift", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, title TEXT)");
    const r = readT3ThreadsFromDb(db, { machineId: "m" });
    expect(r.threads).toEqual([]);
    expect(r.health.reason).toBe("schema_drift");
  });

  it("missing optional tables degrade instead of failing", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT, title TEXT, created_at TEXT, updated_at TEXT);
      INSERT INTO orchestration_v2_projection_threads VALUES ('a','A','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z');`);
    const r = readT3ThreadsFromDb(db, { machineId: "m" });
    expect(r.health.ok).toBe(true);
    expect(r.health.degraded).toContain("projection_projects");
    expect(r.health.degraded).toContain("orchestration_v2_projection_runs");
    expect(r.threads).toHaveLength(1);
    expect(r.threads[0]).toMatchObject({ state: "dormant", projectTitle: null, model: null, provider: null });
  });

  it("missing optional columns (no deleted_at/archived_at/payload_json) still works", () => {
    const db = makeDb();
    db.exec("ALTER TABLE orchestration_v2_projection_provider_sessions DROP COLUMN model");
    const r = readT3ThreadsFromDb(db, { machineId: "m" });
    expect(r.health.ok).toBe(true);
    expect(r.health.degraded).toContain("orchestration_v2_projection_provider_sessions.model");
  });

  it("unknown run status is mapped to null instead of breaking the contract", () => {
    const db = makeDb();
    db.exec("UPDATE orchestration_v2_projection_runs SET status = 'brand-new' WHERE run_id = 'r4'");
    const r = readT3ThreadsFromDb(db, { machineId: "m" });
    expect(byId(r, "t-idle").lastRunStatus).toBeNull();
    expect(AgentThreads.safeParse({ threads: r.threads }).success).toBe(true);
  });

  it("garbage payload_json does not throw", () => {
    const db = makeDb();
    db.exec("UPDATE orchestration_v2_projection_threads SET payload_json = '{not json'");
    const r = readT3ThreadsFromDb(db, { machineId: "m" });
    expect(r.health.ok).toBe(true);
    expect(byId(r, "t-idle").branch).toBeNull();
  });
});

describe("T3 client: file opening", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("missing file -> db_not_found", () => {
    const r = readT3Threads({ machineId: "m", dbPath: "/nonexistent/statev2.sqlite" });
    expect(r).toMatchObject({ threads: [], health: { ok: false, reason: "db_not_found" } });
  });

  it("not a sqlite file -> failure flag, no throw", () => {
    dir = mkdtempSync(join(tmpdir(), "t3c-"));
    const p = join(dir, "bad.sqlite");
    const w = new DatabaseSync(p);
    w.exec("CREATE TABLE x (a)");
    w.close();
    const r = readT3Threads({ machineId: "m", dbPath: p });
    expect(r.health.ok).toBe(false);
    expect(r.threads).toEqual([]);
  });

  it("opens a real file read-only and refuses writes", () => {
    dir = mkdtempSync(join(tmpdir(), "t3c-"));
    const p = join(dir, "statev2.sqlite");
    const w = new DatabaseSync(p);
    w.exec(SCHEMA);
    w.exec(`INSERT INTO orchestration_v2_projection_threads (thread_id,title,created_at,updated_at)
      VALUES ('t1','One','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')`);
    w.close();
    const r = readT3Threads({ machineId: "m", dbPath: p });
    expect(r.health.ok).toBe(true);
    expect(r.threads.map((t) => t.id)).toEqual(["t1"]);
    const ro = new DatabaseSync(p, { readOnly: true });
    expect(() => ro.exec("DELETE FROM orchestration_v2_projection_threads")).toThrow();
    ro.close();
  });
});

describe("helpers", () => {
  it("toIso normalizes common timestamp shapes", () => {
    expect(toIso("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00.000Z");
    expect(toIso("2026-01-01 00:00:00")).toBe("2026-01-01T00:00:00.000Z");
    expect(toIso(1767225600000)).toBe("2026-01-01T00:00:00.000Z");
    expect(toIso(1767225600)).toBe("2026-01-01T00:00:00.000Z");
    expect(toIso("garbage")).toBeNull();
    expect(toIso(null)).toBeNull();
  });

  it("defaultT3DbPath", () => {
    expect(defaultT3DbPath("/home/x")).toBe("/home/x/.t3/userdata/statev2.sqlite");
  });
});
