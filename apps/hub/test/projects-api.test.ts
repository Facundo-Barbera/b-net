import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Deliverable, Project, ProjectSummary, snapshotFixture } from "@fhub/core";
import { createHandler } from "../src/http.ts";
import { MemoryUsageStore } from "../src/store.ts";
import { BOTS, BOT_TOKEN, OTHER_BOT_TOKEN, READ_TOKEN, SAMPLES, setup } from "./projects-helpers.ts";

let env: Awaited<ReturnType<typeof setup>>;
afterEach(() => env?.cleanup());

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("projects API: auth", () => {
  it("writes need a bot token: none or invalid -> 401, valid -> 201 with the bot as author", async () => {
    env = await setup();
    const body = JSON.stringify({ id: "demo", name: "Demo" });
    const none = await env.call("/api/v1/projects", { method: "POST", body });
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Bearer /);
    expect((await env.call("/api/v1/projects", { method: "POST", body, headers: env.auth("not-a-real-token") })).status).toBe(401);
    expect((await env.call("/api/v1/projects", { method: "POST", body, headers: { authorization: "Basic Zm9vOmJhcg==" } })).status).toBe(401);
    expect((await env.createProject()).status).toBe(201);

    const noTok = await env.upload(SAMPLES.png, { title: "p" }, { token: "wrong" });
    expect(noTok.status).toBe(401);
    expect(env.store.listDeliverables("demo")).toHaveLength(0);

    const ok = await env.upload(SAMPLES.png, { title: "p" }, { token: OTHER_BOT_TOKEN });
    expect(ok.status).toBe(201);
    expect(Deliverable.parse(await ok.json()).author).toBe("other-bot");
  });

  it("the hub read token is not a write token; reads accept the hub token or a bot token", async () => {
    env = await setup({ apiToken: READ_TOKEN });
    expect((await env.createProject("demo", READ_TOKEN)).status).toBe(401);
    expect((await env.createProject("demo", BOT_TOKEN)).status).toBe(201);
    expect((await env.call("/api/v1/projects")).status).toBe(401);
    expect((await env.call("/api/v1/projects", { headers: env.auth(READ_TOKEN) })).status).toBe(200);
    expect((await env.call("/api/v1/projects", { headers: env.auth(BOT_TOKEN) })).status).toBe(200);
  });

  it("POST outside the projects routes stays 405; projects without HUB_DATA_DIR are 503", async () => {
    env = await setup();
    expect((await env.call("/api/v1/snapshot", { method: "POST", headers: env.auth() })).status).toBe(405);
    expect((await env.call("/api/v1/projects", { method: "DELETE", headers: env.auth() })).status).toBe(405);
    const bare = createHandler({ snapshot: () => snapshotFixture, store: new MemoryUsageStore(), botTokens: BOTS });
    expect((await bare(new Request("http://hub.invalid/api/v1/projects"))).status).toBe(503);
    const post = await bare(new Request("http://hub.invalid/api/v1/projects", { method: "POST", headers: env.auth(), body: "{}" }));
    expect(post.status).toBe(503);
  });
});

describe("projects API: projects", () => {
  it("creates, lists, gets, and refuses duplicates and invalid input", async () => {
    env = await setup();
    const created = await env.call("/api/v1/projects", {
      method: "POST",
      headers: env.auth(),
      body: JSON.stringify({ id: "fhub", name: "fhub", grouping: { gitRemotes: ["github.com/example/fhub"] }, ownerBot: "fstack-vps" }),
    });
    expect(created.status).toBe(201);
    const p = Project.parse(await created.json());
    expect(p.createdAt).toBe("2026-11-17T10:00:00.000Z");
    expect(p.grouping).toEqual({ t3ProjectTitles: [], paths: [], gitRemotes: ["github.com/example/fhub"] });

    expect((await env.createProject("fhub")).status).toBe(409);
    expect((await env.call("/api/v1/projects", { method: "POST", headers: env.auth(), body: "{not json" })).status).toBe(400);
    const bad = await env.call("/api/v1/projects", { method: "POST", headers: env.auth(), body: JSON.stringify({ id: "../x", name: "x" }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/^id:/);
    const huge = await env.call("/api/v1/projects", { method: "POST", headers: env.auth(), body: "x".repeat(70 * 1024) });
    expect(huge.status).toBe(413);

    const list = (await (await env.call("/api/v1/projects")).json()).projects;
    expect(list).toHaveLength(1);
    expect(ProjectSummary.parse(list[0])).toMatchObject({ id: "fhub", deliverableCount: 0, totalBytes: 0, lastDeliverableAt: null });
    expect((await env.call("/api/v1/projects/fhub")).status).toBe(200);
    expect((await env.call("/api/v1/projects/nope")).status).toBe(404);
  });
});

describe("projects API: deliverables", () => {
  it("stores the upload on disk with the right hash, metadata and project stats", async () => {
    env = await setup();
    await env.createProject();
    const r = await env.upload(SAMPLES.html, { title: "Informe", filename: "informe.html", threadId: "th_01", prUrl: "https://github.com/example/repo/pull/7" });
    expect(r.status).toBe(201);
    const d = Deliverable.parse(await r.json());
    expect(d).toMatchObject({ projectId: "demo", kind: "html", filename: "informe.html", sizeBytes: SAMPLES.html.byteLength, sha256: sha(SAMPLES.html), author: "fstack-vps", threadId: "th_01" });
    expect(readFileSync(env.files.pathFor("demo", d.id))).toEqual(Buffer.from(SAMPLES.html));
    expect(env.tmpFiles()).toEqual([]);

    const list = (await (await env.call("/api/v1/projects/demo/deliverables")).json()).deliverables;
    expect(list.map((x: Deliverable) => x.id)).toEqual([d.id]);
    expect((await (await env.call(`/api/v1/projects/demo/deliverables/${d.id}`)).json()).id).toBe(d.id);
    const p = ProjectSummary.parse(await (await env.call("/api/v1/projects/demo")).json());
    expect(p).toMatchObject({ deliverableCount: 1, totalBytes: SAMPLES.html.byteLength, lastDeliverableAt: d.createdAt });
  });

  it("rejects uploads to unknown projects, without a title, or with unknown query fields", async () => {
    env = await setup();
    await env.createProject();
    expect((await env.upload(SAMPLES.png, { title: "x" }, { project: "nope" })).status).toBe(404);
    expect((await env.upload(SAMPLES.png, {})).status).toBe(400);
    expect((await env.upload(SAMPLES.png, { title: "x", author: "someone" })).status).toBe(400);
    expect((await env.upload(new Uint8Array(0), { title: "x" })).status).toBe(400);
    expect(env.tmpFiles()).toEqual([]);
  });
});

describe("projects API: type allow-list (by content, not only extension)", () => {
  const accepted: Array<[keyof typeof SAMPLES, string | undefined, string]> = [
    ["png", "a.png", "png"],
    ["png", undefined, "png"],
    ["jpeg", "a.JPG", "jpeg"],
    ["webp", "a.webp", "webp"],
    ["pdf", "a.pdf", "pdf"],
    ["mp4", "a.mp4", "mp4"],
    ["webm", "a.webm", "webm"],
    ["html", "a.html", "html"],
    ["svg", "a.svg", "svg"],
    ["markdown", "a.md", "markdown"],
    ["text", "a.txt", "text"],
    ["text", undefined, "text"],
    // HTML bytes under .txt are served as text/plain + nosniff: harmless, so allowed.
    ["html", "a.txt", "text"],
  ];
  it.each(accepted)("accepts %s as %s -> %s", async (sample, filename, kind) => {
    env = await setup();
    await env.createProject();
    const r = await env.upload(SAMPLES[sample], { title: "t", ...(filename ? { filename } : {}) });
    expect(r.status).toBe(201);
    expect((await r.json()).kind).toBe(kind);
  });

  const rejected: Array<[keyof typeof SAMPLES, string | undefined]> = [
    ["html", "a.png"], // text pretending to be an image
    ["png", "a.html"], // image pretending to be HTML
    ["jpeg", "a.png"], // binary mismatch
    ["elf", undefined], // executable, unknown magic
    ["elf", "a.txt"],
    ["gif", "a.gif"], // not in the list
    ["mkv", "a.webm"], // Matroska is not WebM
    ["text", "a.js"], // extension not allowed
    ["text", "a.svg"], // no <svg> root
    ["badUtf8", "a.txt"], // invalid UTF-8
  ];
  it.each(rejected)("rejects %s named %s with 415 and leaves nothing on disk", async (sample, filename) => {
    env = await setup();
    await env.createProject();
    const r = await env.upload(SAMPLES[sample], { title: "t", ...(filename ? { filename } : {}) });
    expect(r.status).toBe(415);
    expect(env.store.listDeliverables("demo")).toHaveLength(0);
    expect(env.tmpFiles()).toEqual([]);
  });
});

describe("projects API: size caps", () => {
  it("per-file cap: 413 mid-stream, stops reading, removes the temp file", async () => {
    env = await setup({ maxBytes: 1024 * 1024 });
    await env.createProject();
    let pulled = 0;
    // Endless source: a buffering implementation would never return.
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        const chunk = new Uint8Array(64 * 1024);
        if (pulled === 0) chunk.set(SAMPLES.png.subarray(0, 8));
        pulled += chunk.byteLength;
        c.enqueue(chunk);
      },
    });
    const r = await env.upload(endless, { title: "big", filename: "big.png" });
    expect(r.status).toBe(413);
    expect(pulled).toBeLessThanOrEqual(1024 * 1024 + 3 * 64 * 1024);
    expect(env.tmpFiles()).toEqual([]);
  });

  it("default per-file cap is 1 GiB and a declared Content-Length over it is refused before reading", async () => {
    env = await setup();
    await env.createProject();
    let read = false;
    // highWaterMark 0: the stream only pulls when the server actually reads.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          read = true;
          c.close();
        },
      },
      { highWaterMark: 0 },
    );
    const r = await env.upload(body, { title: "x" }, { headers: { "content-length": String(1024 ** 3 + 1) } });
    expect(r.status).toBe(413);
    expect((await r.json()).error).toContain(String(1024 ** 3));
    expect(read).toBe(false);
  });

  it("total quota: rejects with 507 and a clear message once the sum would pass it", async () => {
    env = await setup({ quotaBytes: 600 });
    await env.createProject();
    expect((await env.upload(SAMPLES.png, { title: "1" })).status).toBe(201); // 256
    expect((await env.upload(SAMPLES.jpeg, { title: "2" })).status).toBe(201); // 512
    const over = await env.upload(SAMPLES.webp, { title: "3" }); // 768 > 600
    expect(over.status).toBe(507);
    expect((await over.json()).error).toMatch(/quota exceeded.*HUB_DELIVERABLES_QUOTA_GB/);
    expect(env.store.totalBytes()).toBe(512);
    expect(env.tmpFiles()).toEqual([]);
  });

  it("concurrent uploads cannot jointly overshoot the quota", async () => {
    env = await setup({ quotaBytes: 600 });
    await env.createProject();
    const rs = await Promise.all([SAMPLES.png, SAMPLES.jpeg, SAMPLES.webp].map((b, i) => env.upload(b, { title: String(i) })));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 201, 507]);
    expect(env.store.totalBytes()).toBeLessThanOrEqual(600);
    expect(env.tmpFiles()).toEqual([]);
  });
});

describe("projects API: serving content safely", () => {
  async function published(sample: keyof typeof SAMPLES, filename: string) {
    await env.createProject();
    const d = Deliverable.parse(await (await env.upload(SAMPLES[sample], { title: "t", filename })).json());
    return { d, url: `/api/v1/projects/demo/deliverables/${d.id}/content` };
  }

  it.each([
    ["html", "r.html", "text/html; charset=utf-8"],
    ["svg", "d.svg", "image/svg+xml"],
    ["markdown", "n.md", "text/markdown; charset=utf-8"],
    ["png", "i.png", "image/png"],
  ] as const)("%s is sandboxed (no scripts), nosniff, inline", async (sample, filename, mime) => {
    env = await setup();
    const { url } = await published(sample, filename);
    const r = await env.call(url);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe(mime);
    const csp = r.headers.get("content-security-policy")!;
    expect(csp.split(";")[0]).toBe("sandbox");
    expect(csp).not.toContain("allow-scripts");
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/script-src/);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-disposition")).toBe(`inline; filename="${filename}"; filename*=UTF-8''${filename}`);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(SAMPLES[sample]);
  });

  it("PDF keeps nosniff and framing limits but no sandbox (viewers refuse to render under one)", async () => {
    env = await setup();
    const { url } = await published("pdf", "doc.pdf");
    const r = await env.call(url);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-security-policy")).toBe("frame-ancestors 'self'");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("?download=1 forces attachment; non-ASCII names get an ASCII fallback plus filename*", async () => {
    env = await setup();
    const { url } = await published("html", "informe ñandú \"x\".html");
    const r = await env.call(`${url}?download=1`);
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="informe _and_ x.html"; filename*=UTF-8''informe%20%C3%B1and%C3%BA%20x.html`);
  });

  it("supports HEAD, Range (video seeking) and ETag revalidation", async () => {
    env = await setup();
    const { d, url } = await published("mp4", "v.mp4");
    const head = await env.call(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe(String(d.sizeBytes));
    expect(await head.text()).toBe("");

    const part = await env.call(url, { headers: { range: "bytes=4-11" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 4-11/${d.sizeBytes}`);
    expect(Buffer.from(await part.arrayBuffer()).toString("latin1")).toBe("ftypisom");
    expect((await env.call(url, { headers: { range: "bytes=9999-" } })).status).toBe(416);

    const cached = await env.call(url, { headers: { "if-none-match": `"${d.sha256}"` } });
    expect(cached.status).toBe(304);
  });

  it("ids are validated before touching disk: traversal attempts 404, filenames never become paths", async () => {
    env = await setup();
    const { d } = await published("html", "../../../etc/evil.html");
    expect(d.filename).toBe("evil.html");
    expect(existsSync(env.files.pathFor("demo", d.id))).toBe(true);
    for (const p of [
      "/api/v1/projects/..%2F..%2Fetc/deliverables",
      "/api/v1/projects/demo/deliverables/..%2F..%2Fhub.sqlite/content",
      `/api/v1/projects/demo/deliverables/${d.id}%2F..%2F..%2Fx/content`,
      "/api/v1/projects/demo/deliverables/not-a-uuid/content",
      `/api/v1/projects/demo/deliverables/${d.id}/content/extra`,
      `/api/v1/projects/DEMO/deliverables/${d.id}/content`,
    ]) {
      expect((await env.call(p)).status, p).toBe(404);
    }
    // A valid id from another project does not resolve across projects.
    await env.createProject("other");
    expect((await env.call(`/api/v1/projects/other/deliverables/${d.id}/content`)).status).toBe(404);
    expect(() => env.files.pathFor("..", d.id)).toThrow();
    expect(() => env.files.pathFor("demo", "../hub.sqlite")).toThrow();
  });
});
