/**
 * Machine status rules (documented in docs/notes/hub.md). Evaluated in order:
 *
 * 1. unknown  — the Tailscale source has no fresh data AND there are no fresh metrics.
 * 2. offline  — Tailscale reports the node offline (or it is not in the tailnet), and there are no fresh metrics
 *               (fresh metrics from an agent/Beszel override a stale Tailscale "offline").
 * 3. paused   — monitoring is paused in Beszel (system status "paused"). Only Beszel can pause a machine.
 * 4. online   — reachable but with no metrics source configured (no agentUrl, and no beszelName or Beszel not
 *               configured in the hub). Health cannot be judged without metrics, but the machine is up; the UI reads
 *               `metricsSource: "none"` to say which source is missing. Reporting it as "paused" read as
 *               "someone stopped it", which hid real, online machines.
 * 5. degraded — online but: cpu/mem/disk above threshold (default > 90 %), metrics stale (older than
 *               staleMetricsSec, default 300 s) while a metrics source is configured, or Beszel reports
 *               the system "down" while Tailscale says it's online (metrics agent dead).
 * 6. online   — otherwise.
 */
import type { MachineMetrics, MachineStatus } from "@b-net/core";

export interface StatusThresholds {
  cpuPct: number;
  memPct: number;
  diskPct: number;
  staleMetricsSec: number;
}

export const DEFAULT_THRESHOLDS: StatusThresholds = { cpuPct: 90, memPct: 90, diskPct: 90, staleMetricsSec: 300 };

export interface StatusInput {
  /** null = no fresh Tailscale data. */
  tailscaleOnline: boolean | null;
  metrics: MachineMetrics | null;
  metricsAt: string | null;
  /** A source that can actually deliver metrics for this machine is configured (see aggregate.ts). */
  hasMetricsSource: boolean;
  /** Raw Beszel system status when Beszel is the metrics source (up/down/paused/pending). */
  beszelStatus: string | null;
  now: string;
}

export interface StatusResult {
  status: MachineStatus;
  reasons: string[];
}

export function deriveStatus(i: StatusInput, t: StatusThresholds = DEFAULT_THRESHOLDS): StatusResult {
  const ageSec = i.metricsAt ? (Date.parse(i.now) - Date.parse(i.metricsAt)) / 1000 : Infinity;
  const metricsFresh = i.metrics !== null && ageSec <= t.staleMetricsSec;

  if (i.tailscaleOnline === null && !metricsFresh) return { status: "unknown", reasons: ["no tailscale data"] };
  if (i.tailscaleOnline === false && !metricsFresh) return { status: "offline", reasons: ["tailscale offline"] };
  if (i.beszelStatus === "paused") return { status: "paused", reasons: ["paused in beszel"] };
  if (!i.hasMetricsSource) return { status: "online", reasons: ["no metrics source configured"] };

  const reasons: string[] = [];
  const m = i.metrics;
  if (m && metricsFresh) {
    if (m.cpuPct > t.cpuPct) reasons.push(`cpu ${m.cpuPct}% > ${t.cpuPct}%`);
    if (m.memPct > t.memPct) reasons.push(`mem ${m.memPct}% > ${t.memPct}%`);
    if (m.diskPct > t.diskPct) reasons.push(`disk ${m.diskPct}% > ${t.diskPct}%`);
  } else {
    reasons.push("metrics stale or missing");
  }
  if (i.beszelStatus === "down") reasons.push("beszel reports down");
  return reasons.length ? { status: "degraded", reasons } : { status: "online", reasons: [] };
}
