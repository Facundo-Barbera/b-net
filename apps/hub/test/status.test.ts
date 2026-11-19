import { describe, expect, it } from "vitest";
import type { MachineMetrics } from "@fhub/core";
import { sanitizeError } from "../src/health.ts";
import { deriveStatus, type StatusInput } from "../src/status.ts";
import { minutesAgo, NOW } from "./helpers.ts";

const metrics: MachineMetrics = { cpuPct: 20, memPct: 40, memUsedGb: 4, memTotalGb: 10, diskPct: 50, diskUsedGb: 50, diskTotalGb: 100, load1: 1, netRxBps: 0, netTxBps: 0, uptimeSec: 10, tempC: null };
const base: StatusInput = { tailscaleOnline: true, metrics, metricsAt: minutesAgo(1), hasMetricsSource: true, beszelStatus: "up", now: NOW };
const st = (o: Partial<StatusInput>) => deriveStatus({ ...base, ...o }).status;

describe("status rules", () => {
  it("online when healthy", () => expect(st({})).toBe("online"));
  it("degraded above 90% on cpu, mem or disk", () => {
    expect(st({ metrics: { ...metrics, cpuPct: 90 } })).toBe("online");
    expect(st({ metrics: { ...metrics, cpuPct: 90.1 } })).toBe("degraded");
    expect(st({ metrics: { ...metrics, memPct: 95 } })).toBe("degraded");
    expect(deriveStatus({ ...base, metrics: { ...metrics, diskPct: 92.3 } }).reasons).toEqual(["disk 92.3% > 90%"]);
  });
  it("degraded when metrics are stale or Beszel says down", () => {
    expect(st({ metricsAt: minutesAgo(6) })).toBe("degraded");
    expect(st({ metrics: null, metricsAt: null })).toBe("degraded");
    expect(st({ beszelStatus: "down" })).toBe("degraded");
  });
  it("offline / unknown / paused (paused only comes from Beszel)", () => {
    expect(st({ tailscaleOnline: false, metricsAt: minutesAgo(10) })).toBe("offline");
    expect(st({ tailscaleOnline: false })).toBe("online"); // fresh metrics beat a stale tailscale view
    expect(st({ tailscaleOnline: null, metrics: null, metricsAt: null })).toBe("unknown");
    expect(st({ beszelStatus: "paused" })).toBe("paused");
    expect(st({ beszelStatus: "paused", metrics: null, metricsAt: null })).toBe("paused");
  });
  it("a reachable machine without a metrics source is online, not paused", () => {
    const r = deriveStatus({ ...base, hasMetricsSource: false, metrics: null, metricsAt: null, beszelStatus: null });
    expect(r).toEqual({ status: "online", reasons: ["no metrics source configured"] });
    // Tailscale still decides reachability.
    expect(st({ hasMetricsSource: false, metrics: null, metricsAt: null, beszelStatus: null, tailscaleOnline: false })).toBe("offline");
    expect(st({ hasMetricsSource: false, metrics: null, metricsAt: null, beszelStatus: null, tailscaleOnline: null })).toBe("unknown");
  });
  it("custom thresholds", () => {
    expect(deriveStatus({ ...base, metrics: { ...metrics, cpuPct: 85 } }, { cpuPct: 80, memPct: 90, diskPct: 90, staleMetricsSec: 300 }).status).toBe("degraded");
  });
});

describe("sanitizeError", () => {
  it("redacts credentials", () => {
    const s = sanitizeError(new Error("failed: Authorization: Bearer abc.def token=xyz sk-ant-1234567890"));
    expect(s).not.toMatch(/abc\.def|xyz|1234567890/);
  });
});
