import { describe, expect, it } from "vitest";
import { FHUB_EVENT_KINDS, FHUB_EVENT_SCHEMA, FHUB_EVENT_VERSION, WORK_STATES, boardChannel, boardProjectsFixture, projectsFixture } from "../src/index.ts";

describe("boardProjectsFixture", () => {
  const deliverables = new Map(projectsFixture.flatMap((e) => e.deliverables.map((d) => [d.id, d] as const)));

  it("uses the same slugs as the projects fixture, so the UI can join them", () => {
    const slugs = new Set(projectsFixture.map((e) => e.project.id));
    for (const p of boardProjectsFixture.projects) expect(slugs.has(p.slug), p.slug).toBe(true);
  });

  it("summaries point at deliverables that exist in that same project", () => {
    for (const p of boardProjectsFixture.projects) {
      for (const s of p.summaries) {
        const d = deliverables.get(s.id);
        expect(d?.projectId, s.id).toBe(p.slug);
        expect(d?.title).toBe(s.title);
      }
    }
  });

  it("events follow bnet.event@1 and belong to their project", () => {
    for (const p of boardProjectsFixture.projects) {
      for (const e of p.events) {
        expect(e.schema).toBe(FHUB_EVENT_SCHEMA);
        expect(e.version).toBe(FHUB_EVENT_VERSION);
        expect(FHUB_EVENT_KINDS).toContain(e.kind);
        expect(e.project).toBe(p.slug);
      }
    }
  });

  it("covers every task state and the three screens to capture: with data, blocked and empty", () => {
    const states = new Set(boardProjectsFixture.projects.flatMap((p) => p.tasks.map((t) => t.state)));
    expect([...states].sort()).toEqual([...WORK_STATES].sort());
    const empty = boardProjectsFixture.projects.filter((p) => p.tasks.length + p.updates.length + p.prs.length + p.events.length + p.summaries.length === 0);
    expect(empty.map((p) => p.slug)).toEqual(["homelab-ops"]);
    expect(boardProjectsFixture.projects.find((p) => p.slug === "bixku-bot")!.events.map((e) => e.kind)).toContain("blocked");
  });

  it("builds channels as <slug>/<kind>", () => {
    expect(boardChannel("fhub", "tareas")).toBe("fhub/tareas");
  });
});
