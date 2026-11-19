import { describe, expect, it } from "vitest";
import {
  FIXTURE_NOW,
  NO_PROJECT_KEY,
  WorkSnapshot,
  deriveWork,
  prTitle,
  projectHref,
  projectsFixture,
  snapshotFixture,
  t3ThreadHref,
  workFixture,
  type T3ThreadView,
} from "../src/index.ts";

const now = Date.parse(FIXTURE_NOW);
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const thread = (t: Partial<T3ThreadView> & Pick<T3ThreadView, "id" | "state">): T3ThreadView => ({
  machineId: "bixku-vps",
  projectTitle: null,
  title: `hilo ${t.id}`,
  provider: null,
  model: null,
  branch: null,
  createdAt: ago(600),
  updatedAt: ago(10),
  lastRunStatus: null,
  runningSince: null,
  parentThreadId: null,
  ...t,
});
const t3ok = [{ source: "t3" as const, machineId: "bixku-vps", ok: true, lastSuccessAt: ago(0), error: null }];

describe("work contracts", () => {
  it("the canonical fixture is a valid WorkSnapshot", () => {
    expect(WorkSnapshot.safeParse(workFixture).success).toBe(true);
    expect(workFixture.generatedAt).toBe(FIXTURE_NOW);
  });

  it("rejects unknown keys (strict)", () => {
    expect(WorkSnapshot.safeParse({ ...workFixture, extra: 1 }).success).toBe(false);
  });
});

describe("deriveWork", () => {
  it("puts waiting threads first (oldest first), then recent failures", () => {
    const w = deriveWork({
      now,
      sources: t3ok,
      catalog: [],
      threads: [
        thread({ id: "a", state: "waiting", updatedAt: ago(5) }),
        thread({ id: "b", state: "waiting", updatedAt: ago(50) }),
        thread({ id: "c", state: "dormant", lastRunStatus: "failed", updatedAt: ago(30) }),
        thread({ id: "d", state: "idle", lastRunStatus: "interrupted", updatedAt: ago(60 * 80) }), // outside 72 h
      ],
    });
    expect(w.waiting.map((i) => [i.kind, i.id])).toEqual([
      ["needs_input", "needs_input:bixku-vps:b"],
      ["needs_input", "needs_input:bixku-vps:a"],
      ["run_failed", "run_failed:bixku-vps:c"],
    ]);
    expect(w.waiting[0]!.link).toEqual({ kind: "thread", href: t3ThreadHref("bixku-vps", "b") });
  });

  it("running is longest-running first with its start time; done is newest first and recent only", () => {
    const w = deriveWork({
      now,
      sources: t3ok,
      catalog: [],
      threads: [
        thread({ id: "r1", state: "active", runningSince: ago(3) }),
        thread({ id: "r2", state: "active", runningSince: ago(40) }),
        thread({ id: "ok1", state: "idle", lastRunStatus: "completed", updatedAt: ago(20) }),
        thread({ id: "ok2", state: "dormant", lastRunStatus: "completed", updatedAt: ago(5) }),
        thread({ id: "old", state: "dormant", lastRunStatus: "completed", updatedAt: ago(60 * 100) }),
        thread({ id: "arch", state: "archived", lastRunStatus: "completed", updatedAt: ago(1) }),
      ],
    });
    expect(w.running.map((i) => i.id)).toEqual(["running:bixku-vps:r2", "running:bixku-vps:r1"]);
    expect(w.running[0]!.since).toBe(ago(40));
    expect(w.done.map((i) => i.id)).toEqual(["completed:bixku-vps:ok2", "completed:bixku-vps:ok1"]);
    expect(w.threads.map((t) => t.id)).not.toContain("arch");
  });

  it("attributes threads: grouping, then id/name, then a deliverable's threadId, else the T3 title or none", () => {
    const [bnet, ops] = projectsFixture;
    const w = deriveWork({
      now,
      sources: t3ok,
      catalog: [bnet!, ops!],
      threads: [
        thread({ id: "g", state: "idle", projectTitle: "bixku-hub" }), // grouping alias of fhub
        thread({ id: "n", state: "idle", projectTitle: "HOMELAB OPS" }), // name, case-insensitive
        thread({ id: "th_01", state: "idle", projectTitle: "otro" }), // named by a fhub deliverable
        thread({ id: "t", state: "idle", projectTitle: "godot-rpg" }),
        thread({ id: "x", state: "idle" }),
      ],
    });
    const key = Object.fromEntries(w.threads.map((t) => [t.id, t.projectKey]));
    expect(key).toEqual({ g: "fhub", n: "homelab-ops", th_01: "fhub", t: "t3:godot-rpg", x: NO_PROJECT_KEY });
    expect(w.projects.map((p) => [p.ref.key, p.registered])).toEqual([
      ["fhub", true],
      ["homelab-ops", true],
      ["t3:godot-rpg", false],
      [NO_PROJECT_KEY, false],
    ]);
  });

  it("recent deliverables and PR links land in done with in-app and GitHub links; counts per project", () => {
    const w = deriveWork({ now, sources: t3ok, catalog: projectsFixture, threads: [] });
    const deliv = w.done.find((i) => i.kind === "deliverable" && i.project.key === "fhub")!;
    expect(deliv.link).toEqual({ kind: "deliverable", href: projectHref("fhub", "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1") });
    const prs = w.done.filter((i) => i.kind === "pr_linked");
    expect(prs.map((p) => p.title)).toEqual(["Facundo-Barbera/fhub#1", "Facundo-Barbera/fhub#2"]);
    expect(prs[0]!.link?.href).toBe("https://github.com/Facundo-Barbera/fhub/pull/1");
    // The 10-day-old bot deliverable is outside the window but still counted on its project.
    expect(w.done.some((i) => i.project.key === "bixku-bot")).toBe(false);
    const bnet = w.projects.find((p) => p.ref.key === "fhub")!;
    expect(bnet.counts).toMatchObject({ deliverables: 2, prs: 2 });
    expect(w.prs).toHaveLength(2);
  });

  it("reports sources honestly: missing t3, missing store, and never-connected PRs/git/tasks", () => {
    const w = deriveWork({ now, sources: [], catalog: null, threads: [] });
    expect(w.sources).toEqual({ threads: "missing", projects: "missing", pullRequests: "missing", git: "missing", tasks: "missing" });
    const failing = deriveWork({ now, sources: [{ ...t3ok[0]!, ok: false, error: "timeout" }], catalog: [], threads: [] });
    expect(failing.sources.threads).toBe("failing");
    expect(failing.sources.projects).toBe("ok");
  });

  it("fixture: the waiting thread is first and the 72 h-old failure is included", () => {
    expect(workFixture.waiting[0]!.title).toBe("Revisar PR de dotfiles");
    expect(workFixture.waiting.map((i) => i.kind)).toContain("run_failed");
    expect(workFixture.running).toHaveLength(snapshotFixture.threads.filter((t) => t.state === "active").length);
  });
});

describe("links", () => {
  it("encodes thread and project keys", () => {
    expect(t3ThreadHref("pc-bixku", "a/b")).toBe("t3-thread://a%2Fb?machine=pc-bixku");
    expect(projectHref("t3:godot rpg")).toBe("#/projects/t3%3Agodot%20rpg");
    expect(prTitle("https://github.com/o/r/pull/12/files")).toBe("o/r#12");
    expect(prTitle("https://gitlab.example.invalid/x")).toBe("https://gitlab.example.invalid/x");
  });
});
