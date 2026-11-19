import { describe, expect, it } from "vitest";
import { HubSnapshot, IngestRoutes, snapshotFixture, type MachineMetrics } from "@fhub/core";
import { createHandler } from "../src/http.ts";
import { createIngestHandler } from "../src/ingest.ts";
import { RAW_RETENTION_SEC, ROLLUP_RETENTION_SEC, SqliteMetricsStore, hashAgentToken } from "../src/metrics-store.ts";
import { MemoryUsageStore } from "../src/store.ts";
import { buildHub, machinesExample, NOW } from "./helpers.ts";

const nowSec = Date.parse(NOW) / 1000;
const sample = (over: Partial<MachineMetrics> = {}): MachineMetrics => ({
  cpuPct: 10, memPct: 40, memUsedGb: 3.2, memTotalGb: 8, diskPct: 50, diskUsedGb: 50, diskTotalGb: 100,
  load1: 0.5, netRxBps: 1000, netTxBps: 500, uptimeSec: 3600, tempC: null, ...over,
});
const known = new Set(machinesExample.map((m) => m.id));

function post(token: string | null, body: unknown, extra: Record<string, string> = {}) {
  return new Request(`http://hub.invalid${IngestRoutes.metrics}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("SqliteMetricsStore: tokens", () => {
  it("keeps only the hash, resolves the machine, rotates and revokes", () => {
    const s = new SqliteMetricsStore(":memory:");
    const t1 = s.issueToken("bixku-mbp");
    expect(t1).toMatch(/^bnet_agent_[A-Za-z0-9_-]{43}$/);
    expect(s.machineForToken(t1)).toBe("bixku-mbp");
    const t2 = s.issueToken("bixku-mbp");
    expect(s.machineForToken(t1)).toBeNull(); // rotated: old token stops working
    expect(s.machineForToken(t2)).toBe("bixku-mbp");
    expect(s.listTokens().map((t) => t.machineId)).toEqual(["bixku-mbp"]);
    // the plaintext is nowhere in the database
    const db = (s as unknown as { db: { prepare(q: string): { all(): unknown[] } } }).db;
    expect(JSON.stringify(db.prepare("SELECT * FROM agent_tokens").all())).not.toContain(t2);
    expect(JSON.stringify(db.prepare("SELECT * FROM agent_tokens").all())).toContain(hashAgentToken(t2));
    expect(s.revokeToken("bixku-mbp")).toBe(true);
    expect(s.machineForToken(t2)).toBeNull();
  });
});

describe("SqliteMetricsStore: retention", () => {
  it("rolls closed 5-minute buckets into averages (NULLs ignored) and keeps the open one raw", () => {
    const s = new SqliteMetricsStore(":memory:");
    const b = Math.floor(nowSec / 300) * 300 - 300; // previous, closed bucket
    s.insert("pc-bixku", b + 10, sample({ cpuPct: 10, load1: null }));
    s.insert("pc-bixku", b + 40, sample({ cpuPct: 30, load1: 2 }));
    s.insert("pc-bixku", b + 310, sample({ cpuPct: 99 })); // open bucket
    s.maintain(b + 320);
    const r = s.rollups("pc-bixku", 0);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ bucket: b, samples: 2 });
    expect(r[0]!.metrics.cpuPct).toBe(20);
    expect(r[0]!.metrics.load1).toBe(2);
    expect(r[0]!.metrics.tempC).toBeNull();
  });

  it("deletes raw rows after 24 h and rollups after 30 days, without losing the 30-day averages", () => {
    const s = new SqliteMetricsStore(":memory:");
    const t0 = Math.floor(nowSec / 300) * 300;
    s.insert("pc-bixku", t0 - ROLLUP_RETENTION_SEC - 600, sample());
    s.insert("pc-bixku", t0 - RAW_RETENTION_SEC - 600, sample({ cpuPct: 70 }));
    s.insert("pc-bixku", t0 - 60, sample());
    s.maintain(t0);
    expect(s.recent("pc-bixku", 0).map((x) => x.ts)).toEqual([t0 - 60]);
    // the day-old sample's bucket was rolled before its raw row expired; the 30-day-old one is gone entirely
    const buckets = s.rollups("pc-bixku", 0).map((x) => x.bucket);
    expect(buckets).toContain(t0 - RAW_RETENTION_SEC - 600);
    expect(buckets).not.toContain(t0 - ROLLUP_RETENTION_SEC - 600);
    expect(s.counts().raw).toBe(1);
  });

  it("maintenance runs at most once per bucket from insert()", () => {
    const s = new SqliteMetricsStore(":memory:");
    let calls = 0;
    const orig = s.maintain.bind(s);
    s.maintain = (n) => (calls++, orig(n));
    const b = Math.floor(nowSec / 300) * 300;
    for (let i = 0; i < 10; i++) s.insert("pc-bixku", b + i * 30, sample());
    expect(calls).toBe(1);
    s.insert("pc-bixku", b + 300, sample());
    expect(calls).toBe(2);
  });
});

describe("ingest handler", () => {
  const setup = () => {
    const store = new SqliteMetricsStore(":memory:");
    const token = store.issueToken("bixku-mbp");
    const ingest = createIngestHandler({ store, knownMachines: known, clock: () => new Date(NOW) });
    const handler = createHandler({ snapshot: () => snapshotFixture, store: new MemoryUsageStore(), apiToken: "api-token-placeholder", ingest });
    return { store, token, handler };
  };
  const body = { machineId: "bixku-mbp", agentVersion: "0.2.0", metrics: sample() };

  it("stores a valid sample with the hub clock and answers 204 (the /api token does not apply)", async () => {
    const { store, token, handler } = setup();
    const r = await handler(post(token, body));
    expect(r.status).toBe(204);
    expect(store.recent("bixku-mbp", 0)).toEqual([{ ts: nowSec, metrics: sample() }]);
  });

  it("refuses missing/unknown tokens, foreign machine ids, bad payloads, oversize bodies and GET", async () => {
    const { store, token, handler } = setup();
    const other = store.issueToken("bixku-mba");
    expect((await handler(post(null, body))).status).toBe(401);
    expect((await handler(post("bnet_agent_not-a-real-token-at-all", body))).status).toBe(401);
    expect((await handler(post(other, body))).status).toBe(403); // token of bixku-mba, body says bixku-mbp
    expect((await handler(post(token, "{not json"))).status).toBe(400);
    expect((await handler(post(token, { ...body, metrics: { ...sample(), cpuPct: 140 } }))).status).toBe(400);
    expect((await handler(post(token, { ...body, extra: 1 }))).status).toBe(400);
    expect((await handler(post(token, { ...body, agentVersion: "x".repeat(9000) }))).status).toBe(413);
    expect((await handler(new Request(`http://hub.invalid${IngestRoutes.metrics}`))).status).toBe(405);
    expect(store.recent("bixku-mbp", 0)).toEqual([]);
  });

  it("refuses a valid token for a machine missing from machines.json", async () => {
    const store = new SqliteMetricsStore(":memory:");
    const token = store.issueToken("ghost");
    const ingest = createIngestHandler({ store, knownMachines: known });
    expect((await ingest(post(token, { ...body, machineId: "ghost" }))).status).toBe(403);
  });

  it("answers 404 when the hub has no ingest configured", async () => {
    const handler = createHandler({ snapshot: () => snapshotFixture, store: new MemoryUsageStore() });
    expect((await handler(post("x", body))).status).toBe(404);
  });
});

describe("hub snapshot with pushed metrics", () => {
  it("prefers a fresh push over Beszel, builds history, and reports agent source health", async () => {
    const metrics = new SqliteMetricsStore(":memory:");
    metrics.issueToken("bixku-homelab");
    metrics.insert("bixku-homelab", nowSec - 60, sample({ cpuPct: 5 }));
    metrics.insert("bixku-homelab", nowSec - 30, sample({ cpuPct: 7 }));
    const { hub } = buildHub({ deps: { metrics } });
    await hub.pollAll();
    const snap = hub.snapshot();
    expect(HubSnapshot.safeParse(snap).success).toBe(true);
    const m = snap.machines.find((x) => x.id === "bixku-homelab")!;
    expect(m.metricsSource).toBe("agent");
    expect(m.metrics!.cpuPct).toBe(7);
    expect(m.metricsAt).toBe(new Date((nowSec - 30) * 1000).toISOString());
    expect(m.history).toEqual({ stepSec: 30, cpuPct: [5, 7], memPct: [40, 40] });
    expect(snap.sources).toContainEqual({ source: "agent", machineId: "bixku-homelab", ok: true, lastSuccessAt: m.metricsAt, error: null });
  });

  it("falls back to Beszel when the push is stale, and to nothing when there is no Beszel either", async () => {
    const metrics = new SqliteMetricsStore(":memory:");
    metrics.issueToken("bixku-homelab");
    metrics.issueToken("bixku-mba"); // no Beszel, no agentUrl: the token alone makes it a metrics source
    metrics.insert("bixku-homelab", nowSec - 600, sample({ cpuPct: 5 }));
    const { hub } = buildHub({ deps: { metrics } });
    await hub.pollAll();
    const snap = hub.snapshot();
    const home = snap.machines.find((x) => x.id === "bixku-homelab")!;
    expect(home.metricsSource).toBe("beszel");
    expect(home.metrics!.cpuPct).toBe(23.4);
    const mba = snap.machines.find((x) => x.id === "bixku-mba")!;
    expect(mba.metricsSource).toBe("none");
    expect(mba.status).toBe("degraded"); // has a source now, but nothing arrived (was "paused")
    expect(snap.sources.find((s) => s.source === "agent" && s.machineId === "bixku-homelab")).toMatchObject({ ok: false, error: "no push for 600 s" });
    expect(snap.sources.find((s) => s.source === "agent" && s.machineId === "bixku-mba")).toMatchObject({ ok: false, error: "no push received" });
  });
});

describe("GPU and WSL fields", () => {
  const gpu = { name: "NVIDIA GeForce RTX 3050", count: 1, utilPct: 40, memUsedMb: 1000, memTotalMb: 8192, tempC: 50 };

  it("round-trip through raw storage, and samples without them read back without the keys", () => {
    const s = new SqliteMetricsStore(":memory:");
    s.insert("pc-bixku", nowSec - 30, sample({ gpu, wslVm: true }));
    s.insert("bixku-mbp", nowSec - 30, sample());
    expect(s.recent("pc-bixku", 0)[0]!.metrics).toEqual(sample({ gpu, wslVm: true }));
    const plain = s.recent("bixku-mbp", 0)[0]!.metrics;
    expect("gpu" in plain || "wslVm" in plain).toBe(false);
  });

  it("are averaged (numbers) and kept (name, count, WSL flag) in the 5-minute rollup", () => {
    const s = new SqliteMetricsStore(":memory:");
    const b = Math.floor(nowSec / 300) * 300 - 300;
    s.insert("pc-bixku", b + 10, sample({ gpu, wslVm: true }));
    s.insert("pc-bixku", b + 40, sample({ gpu: { ...gpu, utilPct: 80, tempC: null }, wslVm: true }));
    s.maintain(b + 300);
    expect(s.rollups("pc-bixku", 0)[0]!.metrics).toMatchObject({ gpu: { ...gpu, utilPct: 60, tempC: 50 }, wslVm: true });
  });

  it("the ingest contract accepts them and rejects unknown GPU keys", async () => {
    const store = new SqliteMetricsStore(":memory:");
    const token = store.issueToken("pc-bixku");
    const ingest = createIngestHandler({ store, knownMachines: known, clock: () => new Date(NOW) });
    const body = { machineId: "pc-bixku", agentVersion: "0.3.0", metrics: sample({ gpu, wslVm: true }) };
    expect((await ingest(post(token, body))).status).toBe(204);
    expect((await ingest(post(token, { ...body, metrics: { ...body.metrics, gpu: { ...gpu, fan: 30 } } }))).status).toBe(400);
  });
});
