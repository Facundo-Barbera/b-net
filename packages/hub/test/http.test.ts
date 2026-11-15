import { describe, expect, it } from "vitest";
import { HubSnapshot, MachineView, SecretMeta, UsageRecordsPage, snapshotFixture } from "@b-net/core";
import { createHandler, type StaticReader } from "../src/http.ts";
import { MemoryUsageStore } from "../src/store.ts";

const store = new MemoryUsageStore();
store.append(snapshotFixture.proxy!.recent);
const files: Record<string, string> = { "index.html": "<!doctype html><title>hub</title>", "assets/app-abc.js": "console.log(1)" };
const staticFiles: StaticReader = async (p) => (p in files ? new TextEncoder().encode(files[p]) : null);
const TOKEN = "placeholder-hub-token";

const handler = createHandler({ snapshot: () => snapshotFixture, store, staticFiles });
const authed = createHandler({ snapshot: () => snapshotFixture, store, apiToken: TOKEN, staticFiles: null });
const get = (path: string, init?: RequestInit, h = handler) => h(new Request(`http://hub.invalid${path}`, init));

describe("hub HTTP handler", () => {
  it("serves the snapshot", async () => {
    const r = await get("/api/v1/snapshot");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(HubSnapshot.safeParse(await r.json()).success).toBe(true);
  });

  it("serves machines and a single machine", async () => {
    const all = await (await get("/api/v1/machines")).json();
    expect(all.machines).toHaveLength(snapshotFixture.machines.length);
    const one = await get("/api/v1/machines/pc-bixku");
    expect(MachineView.parse(await one.json()).status).toBe("degraded");
    expect((await get("/api/v1/machines/nope")).status).toBe(404);
  });

  it("filters threads", async () => {
    const r = await (await get("/api/v1/threads?machine=bixku-vps&state=dormant")).json();
    expect(r.threads.map((t: { id: string }) => t.id)).toEqual(["th_05", "th_06", "th_07"]);
    expect((await get("/api/v1/threads?state=bogus")).status).toBe(400);
  });

  it("serves accounts, proxy status, health", async () => {
    expect((await (await get("/api/v1/usage/accounts")).json()).accounts).toHaveLength(snapshotFixture.accounts.length);
    expect((await (await get("/api/v1/proxy/status")).json()).version).toBe(snapshotFixture.proxy!.version);
    const h = await (await get("/api/v1/health")).json();
    expect(h.ok).toBe(true);
    expect(h.sources).toEqual(snapshotFixture.sources);
    const noProxy = createHandler({ snapshot: () => ({ ...snapshotFixture, proxy: null }), store });
    expect((await get("/api/v1/proxy/status", undefined, noProxy)).status).toBe(503);
  });

  it("pages usage records by cursor and account", async () => {
    const p1 = UsageRecordsPage.parse(await (await get("/api/v1/usage/records?limit=5")).json());
    expect(p1.records).toHaveLength(5);
    expect(p1.nextCursor).toBe(p1.records[4]!.id);
    const p2 = UsageRecordsPage.parse(await (await get(`/api/v1/usage/records?limit=100&since=${p1.nextCursor}`)).json());
    expect(p2.records).toHaveLength(snapshotFixture.proxy!.recent.length - 5);
    expect(p2.nextCursor).toBeNull();
    const oa = UsageRecordsPage.parse(await (await get("/api/v1/usage/records?account=openai-pro-1")).json());
    expect(oa.records.every((r) => r.accountId === "openai-pro-1")).toBe(true);
    expect((await get("/api/v1/usage/records?limit=abc")).status).toBe(400);
    expect((await get("/api/v1/usage/records?since=%27%20OR%201")).status).toBe(400);
  });

  it("secrets endpoint returns SecretMeta only", async () => {
    const leaky = { ...snapshotFixture, secrets: [{ ...snapshotFixture.secrets[0]!, value: "sk-FAKE-LEAK" } as never, snapshotFixture.secrets[1]!] };
    const h = createHandler({ snapshot: () => leaky, store });
    const body = await (await get("/api/v1/secrets", undefined, h)).text();
    expect(body).not.toContain("sk-FAKE-LEAK");
    const parsed = JSON.parse(body).secrets;
    expect(parsed).toHaveLength(1);
    expect(SecretMeta.safeParse(parsed[0]).success).toBe(true);
  });

  it("is read-only", async () => {
    expect((await get("/api/v1/snapshot", { method: "POST" })).status).toBe(405);
    expect((await get("/api/v1/snapshot", { method: "DELETE" })).status).toBe(405);
    const head = await get("/api/v1/snapshot", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("enforces the optional bearer token on /api", async () => {
    expect((await get("/api/v1/health", undefined, authed)).status).toBe(401);
    expect((await get("/api/v1/health", { headers: { authorization: "Bearer wrong" } }, authed)).status).toBe(401);
    expect((await get("/api/v1/health", { headers: { authorization: `Bearer ${TOKEN}` } }, authed)).status).toBe(200);
    expect((await get("/", undefined, authed)).status).toBe(404); // no UI built
  });

  it("serves static UI with SPA fallback and blocks traversal", async () => {
    const idx = await get("/");
    expect(idx.headers.get("content-type")).toContain("text/html");
    expect(await idx.text()).toContain("<title>hub</title>");
    const js = await get("/assets/app-abc.js");
    expect(js.headers.get("cache-control")).toContain("immutable");
    expect(await (await get("/machines/pc-bixku")).text()).toContain("<title>hub</title>");
    expect((await get("/assets/missing.js")).status).toBe(404);
    // URL parsing already resolves dot segments; encoded slashes are caught by safeRel
    expect(await (await get("/%2e%2e/%2e%2e/etc/passwd")).text()).toContain("<title>hub</title>");
    expect((await get("/assets/..%2f..%2fsecret.js")).status).toBe(404);
    expect((await get("/.env")).status).toBe(404);
    expect((await get("/api/v1/unknown")).status).toBe(404);
  });
});

describe("fsStaticReader", () => {
  it("reads inside root only", async () => {
    const { mkdtempSync, writeFileSync, mkdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { fsStaticReader } = await import("../src/http.ts");
    const dir = mkdtempSync(join(tmpdir(), "hub-static-"));
    mkdirSync(join(dir, "app"));
    writeFileSync(join(dir, "app", "index.html"), "ok");
    writeFileSync(join(dir, "outside.txt"), "nope");
    const read = fsStaticReader(join(dir, "app"));
    expect(new TextDecoder().decode((await read("index.html"))!)).toBe("ok");
    expect(await read("../outside.txt")).toBeNull();
    expect(await read("missing.js")).toBeNull();
  });
});
