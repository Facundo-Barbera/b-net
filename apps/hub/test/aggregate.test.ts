import { describe, expect, it } from "vitest";
import { HubSnapshot, snapshotFixture } from "@fhub/core";
import { aggregate } from "../src/aggregate.ts";
import { buildHub, machinesExample, NOW, minutesAgo } from "./helpers.ts";

describe("aggregation (golden)", async () => {
  const { hub } = buildHub();
  await hub.pollAll();
  const snap = hub.snapshot();
  const byId = Object.fromEntries(snap.machines.map((m) => [m.id, m]));

  it("validates against HubSnapshot", () => {
    const r = HubSnapshot.safeParse(snap);
    if (!r.success) console.error(r.error.issues.slice(0, 5));
    expect(r.success).toBe(true);
    expect(snap.generatedAt).toBe(NOW);
    expect(snap.hubMachineId).toBe("bixku-homelab");
    expect(snap.machines.map((m) => m.id)).toEqual(machinesExample.map((m) => m.id));
  });

  it("derives status, link path and latency per machine (matches canonical fixture)", () => {
    const summary = Object.fromEntries(
      snap.machines.map((m) => [m.id, [m.status, m.tailscale.path, m.tailscale.latencyMs, m.tailscale.relay, m.metricsSource]]),
    );
    expect(summary).toEqual({
      "bixku-homelab": ["online", "self", 0, null, "beszel"],
      "bixku-vps": ["online", "direct", 148, null, "beszel"], // agent metrics failed -> Beszel fallback
      "bixku-focaltec": ["online", "direct", 12.3, null, "beszel"], // beszelName "focaltec"
      "pc-bixku": ["degraded", "derp", 87, "mia", "agent"], // cpu 91.5 > 90
      "bixku-mbp": ["offline", "unknown", null, null, "none"],
      "bixku-mba": ["online", "peer-relay", 34, null, "none"], // reachable, no metrics source configured
    });
    for (const m of snap.machines) {
      const canon = snapshotFixture.machines.find((x) => x.id === m.id)!;
      expect(m.status, m.id).toBe(canon.status);
      expect(m.tailscale.ip, m.id).toBe(canon.tailscale.ip);
      expect(m.tailscale.path, m.id).toBe(canon.tailscale.path);
    }
  });

  it("maps Beszel metrics and keeps agent metrics for the agent machine", () => {
    expect(byId["bixku-homelab"]!.metrics).toMatchObject({ cpuPct: 23.4, memTotalGb: 7.5, tempC: 52 });
    expect(byId["bixku-vps"]!.metrics).toMatchObject({ cpuPct: 61.8, memUsedGb: 12.9, diskTotalGb: 400, load1: 3.1 });
    expect(byId["pc-bixku"]!.metrics).toEqual(snapshotFixture.machines.find((m) => m.id === "pc-bixku")!.metrics);
    expect(byId["bixku-mbp"]!.tailscale.lastSeen).toBe("2026-11-14T18:30:00.000Z");
    expect(byId["bixku-homelab"]!.notes).toBe("Mac mini con Ubuntu");
  });

  it("collects threads from agents and exporters; threadCounts exclude archived", () => {
    const counts = Object.fromEntries(snap.machines.map((m) => [m.id, m.threadCounts]));
    const canon = Object.fromEntries(snapshotFixture.machines.map((m) => [m.id, m.threadCounts]));
    expect(counts).toEqual(canon);
    expect(snap.threads).toHaveLength(snapshotFixture.threads.length);
    expect(snap.threads.every((t) => t.machineId !== "wrong-id")).toBe(true);
    expect(snap.threads[0]!.state).toBe("active");
  });

  it("includes proxy status, accounts and projected secrets (no values)", () => {
    expect(snap.proxy?.version).toBe(snapshotFixture.proxy!.version);
    expect(snap.accounts.map((a) => a.id)).toEqual(snapshotFixture.accounts.map((a) => a.id));
    expect(snap.secrets).toHaveLength(snapshotFixture.secrets.length);
    expect(JSON.stringify(snap)).not.toContain("sk-ant-FAKE");
  });

  it("reports SourceHealth per source", () => {
    const h = (source: string, machineId: string | null) => snap.sources.find((s) => s.source === source && s.machineId === machineId);
    expect(h("tailscale", null)).toMatchObject({ ok: true, lastSuccessAt: NOW, error: null });
    expect(h("beszel", null)?.ok).toBe(true);
    expect(h("proxy", null)?.ok).toBe(true);
    expect(h("agent", "bixku-vps")).toMatchObject({ ok: false, error: "SourceError: GET /agent/v1/metrics: HTTP 503" });
    expect(h("t3", "bixku-vps")?.ok).toBe(true);
    expect(h("agent", "pc-bixku")?.ok).toBe(true);
    expect(h("t3", null)?.ok).toBe(true);
  });

  it("ingested usage records into the store", () => {
    expect(hub.store.count()).toBe(snapshotFixture.proxy!.recent.length);
  });
});

describe("aggregation rules", () => {
  const base = {
    now: NOW, hubVersion: "t", hubMachineId: "bixku-homelab", machines: machinesExample, tailscale: null, beszel: null,
    beszelConfigured: true, agentMetrics: {}, threads: [], proxy: null, sources: [],
  };

  it("without tailscale data and metrics everything is unknown", () => {
    const s = aggregate(base);
    expect(new Set(s.machines.map((m) => m.status))).toEqual(new Set(["unknown"]));
    expect(HubSnapshot.safeParse(s).success).toBe(true);
  });

  it("agent wins over Beszel when fresh; Beszel wins over stale agent", () => {
    const beszel = [{ systemId: "s", name: "bixku-vps", status: "up", metricsAt: minutesAgo(1), history: null,
      metrics: { cpuPct: 10, memPct: 10, memUsedGb: 1, memTotalGb: 10, diskPct: 10, diskUsedGb: 1, diskTotalGb: 10, load1: null, netRxBps: null, netTxBps: null, uptimeSec: null, tempC: null } }];
    const agentM = (at: string) => ({ "bixku-vps": { machineId: "bixku-vps", at, history: null, metrics: { ...beszel[0]!.metrics, cpuPct: 55 } } });
    const fresh = aggregate({ ...base, beszel, agentMetrics: agentM(minutesAgo(0.5)) }).machines.find((m) => m.id === "bixku-vps")!;
    expect([fresh.metricsSource, fresh.metrics?.cpuPct]).toEqual(["agent", 55]);
    const stale = aggregate({ ...base, beszel, agentMetrics: agentM(minutesAgo(30)) }).machines.find((m) => m.id === "bixku-vps")!;
    expect([stale.metricsSource, stale.metrics?.cpuPct]).toEqual(["beszel", 10]);
  });

  it("a beszelName without Beszel configured is not a metrics source", async () => {
    const { hub } = buildHub({ deps: { beszel: null } });
    await hub.pollAll();
    const byId = Object.fromEntries(hub.snapshot().machines.map((m) => [m.id, m]));
    // Only a beszelName: reachable and online (not degraded for a source that was never connected).
    expect([byId["bixku-homelab"]!.status, byId["bixku-homelab"]!.metricsSource]).toEqual(["online", "none"]);
    // agentUrl configured but the agent answers 503: that source is broken, so degraded is right.
    expect([byId["bixku-vps"]!.status, byId["bixku-vps"]!.metricsSource]).toEqual(["degraded", "none"]);
  });

  it("drops threads of machines not in config", () => {
    const t = { ...snapshotFixture.threads[0]!, machineId: "ghost" };
    expect(aggregate({ ...base, threads: [t] }).threads).toEqual([]);
  });
});

describe("staleness", () => {
  it("treats tailscale data older than 3 cycles as absent", async () => {
    let now = Date.parse(NOW);
    const { hub } = buildHub({ now: () => new Date(now) });
    await hub.pollAll();
    now += 46_000; // > 3 x 15 s
    const snap = hub.snapshot();
    // tailscale + beszel stale, pc agent metrics still fresh (agent cycle 30 s x 3)
    expect(snap.machines.find((m) => m.id === "bixku-mbp")!.status).toBe("unknown");
    expect(snap.machines.find((m) => m.id === "pc-bixku")!.metricsSource).toBe("agent");
  });
});
