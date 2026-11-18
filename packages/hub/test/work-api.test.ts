import { afterEach, describe, expect, it } from "vitest";
import { WorkSnapshot, snapshotFixture } from "@b-net/core";
import { createHandler } from "../src/http.ts";
import { createProjectsApi } from "../src/projects-http.ts";
import { MemoryUsageStore } from "../src/store.ts";
import { NOW, SAMPLES, setup } from "./projects-helpers.ts";

let cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
});

const get = async (handler: ReturnType<typeof createHandler>, path = "/api/v1/work") => handler(new Request(`http://hub.invalid${path}`));

describe("GET /api/v1/work", () => {
  it("without projects storage: threads only, projects reported missing", async () => {
    const handler = createHandler({ snapshot: () => snapshotFixture, store: new MemoryUsageStore(), clock: () => new Date(snapshotFixture.generatedAt) });
    const res = await get(handler);
    expect(res.status).toBe(200);
    const body = WorkSnapshot.parse(await res.json());
    expect(body.sources.projects).toBe("missing");
    expect(body.sources.threads).toBe("ok");
    expect(body.sources.pullRequests).toBe("missing");
    expect(body.waiting[0]?.kind).toBe("needs_input");
    expect(body.running.length).toBeGreaterThan(0);
    // No registered projects: every project row is inferred from T3 titles.
    expect(body.projects.every((p) => !p.registered)).toBe(true);
  });

  it("joins projects and deliverables uploaded through the API", async () => {
    const s = await setup();
    cleanups.push(s.cleanup);
    expect((await s.createProject("b-net")).status).toBe(201);
    const up = await s.upload(SAMPLES.html, { title: "Resumen del PR", threadId: "th_01", prUrl: "https://github.com/example/repo/pull/7" }, { project: "b-net" });
    expect(up.status).toBe(201);
    const { id } = (await up.json()) as { id: string };

    const handler = createHandler({
      snapshot: () => snapshotFixture,
      store: new MemoryUsageStore(),
      projects: createProjectsApi({ store: s.store, files: s.files, quotaBytes: 1e9, clock: () => new Date(NOW) }),
      clock: () => new Date(NOW),
    });
    const body = WorkSnapshot.parse(await (await get(handler)).json());
    expect(body.sources.projects).toBe("ok");
    const project = body.projects.find((p) => p.ref.key === "b-net")!;
    expect(project.registered).toBe(true);
    expect(project.counts.deliverables).toBe(1);
    expect(project.counts.prs).toBe(1);
    // Fixture threads with projectTitle "b-net" are attributed to the registered project by name.
    expect(project.counts.threads).toBeGreaterThan(0);
    expect(body.done.find((i) => i.kind === "deliverable")?.link?.href).toBe(`#/projects/b-net/d/${id}`);
    expect(body.done.find((i) => i.kind === "pr_linked")?.title).toBe("example/repo#7");
  });

  it("is read-only and honours the hub token", async () => {
    const handler = createHandler({ snapshot: () => snapshotFixture, store: new MemoryUsageStore(), apiToken: "placeholder-hub-token" });
    expect((await get(handler)).status).toBe(401);
    const ok = await handler(new Request("http://hub.invalid/api/v1/work", { headers: { authorization: "Bearer placeholder-hub-token" } }));
    expect(ok.status).toBe(200);
    expect((await handler(new Request("http://hub.invalid/api/v1/work", { method: "POST" }))).status).toBe(405);
  });
});
