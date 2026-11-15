/**
 * Pure aggregation: MachineConfig + Tailscale + latency + metrics (agent > Beszel) + T3 threads
 * + proxy data -> HubSnapshot. No I/O here; the hub feeds already-fetched (and freshness-filtered) inputs.
 */
import type {
  AccountView, AgentMetrics, HubSnapshot, MachineConfig, MachineView, ProxyStatus, SecretMeta, SourceHealth, T3ThreadView,
} from "@b-net/core";
import type { BeszelMachine } from "@b-net/core/clients/beszel";
import { indexByHostName, toTailscaleLink, type PingOutcome, type TailscaleStatus } from "@b-net/core/clients/tailscale";
import { DEFAULT_THRESHOLDS, deriveStatus, type StatusThresholds } from "./status.ts";

export interface AggregateInput {
  now: string;
  hubVersion: string;
  hubMachineId: string;
  machines: MachineConfig[];
  /** null = no fresh Tailscale data. */
  tailscale: { status: TailscaleStatus; pings: Record<string, PingOutcome> } | null;
  /** null = Beszel not configured or no fresh data. */
  beszel: BeszelMachine[] | null;
  /** Latest agent metrics by machine id. */
  agentMetrics: Record<string, AgentMetrics>;
  threads: T3ThreadView[];
  proxy: { status: ProxyStatus | null; accounts: AccountView[]; secrets: SecretMeta[] } | null;
  sources: SourceHealth[];
  thresholds?: StatusThresholds;
}

const THREAD_ORDER: Record<T3ThreadView["state"], number> = { active: 0, waiting: 1, idle: 2, dormant: 3, archived: 4 };

export function threadCountsFor(machineId: string, threads: T3ThreadView[]): MachineView["threadCounts"] {
  const c = { active: 0, waiting: 0, idle: 0, dormant: 0 };
  for (const t of threads) if (t.machineId === machineId && t.state !== "archived") c[t.state]++;
  return c;
}

function pickMetrics(m: MachineConfig, input: AggregateInput, t: StatusThresholds) {
  const agent = input.agentMetrics[m.id];
  const beszel = m.beszelName ? input.beszel?.find((b) => b.name.toLowerCase() === m.beszelName!.toLowerCase()) : undefined;
  const fresh = (at: string | null) => at !== null && (Date.parse(input.now) - Date.parse(at)) / 1000 <= t.staleMetricsSec;
  // Priority: fresh agent > Beszel (with data) > stale agent > none.
  if (agent && fresh(agent.at)) return { source: "agent" as const, metrics: agent.metrics, at: agent.at, history: agent.history, beszelStatus: null };
  if (beszel && beszel.metrics) return { source: "beszel" as const, metrics: beszel.metrics, at: beszel.metricsAt, history: beszel.history, beszelStatus: beszel.status };
  if (agent) return { source: "agent" as const, metrics: agent.metrics, at: agent.at, history: agent.history, beszelStatus: null };
  return { source: "none" as const, metrics: null, at: null, history: null, beszelStatus: beszel?.status ?? null };
}

export function aggregate(input: AggregateInput): HubSnapshot {
  const t = input.thresholds ?? DEFAULT_THRESHOLDS;
  const tsIndex = input.tailscale ? indexByHostName(input.tailscale.status) : null;
  const known = new Set(input.machines.map((m) => m.id));

  const threads = [...input.threads]
    .filter((th) => known.has(th.machineId))
    .sort((a, b) => THREAD_ORDER[a.state] - THREAD_ORDER[b.state] || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));

  const machines: MachineView[] = input.machines.map((m) => {
    const entry = tsIndex?.get(m.tailscaleHost.toLowerCase());
    const link = entry
      ? toTailscaleLink(entry.peer, { isSelf: entry.isSelf || m.id === input.hubMachineId, ping: input.tailscale!.pings[m.id] ?? null, now: input.now })
      : { ip: null, online: false, lastSeen: null, latencyMs: null, path: "unknown" as const, relay: null };
    const picked = pickMetrics(m, input, t);
    const { status } = deriveStatus(
      {
        tailscaleOnline: tsIndex ? (entry ? link.online : false) : null,
        metrics: picked.metrics,
        metricsAt: picked.at,
        hasMetricsSource: Boolean(m.beszelName || m.agentUrl),
        beszelStatus: picked.beszelStatus,
        now: input.now,
      },
      t,
    );
    return {
      id: m.id,
      name: m.name,
      role: m.role,
      os: m.os,
      status,
      tailscale: link,
      metrics: picked.metrics,
      metricsSource: picked.source,
      metricsAt: picked.at,
      history: picked.history,
      services: [],
      threadCounts: threadCountsFor(m.id, threads),
      notes: m.notes ?? null,
    };
  });

  return {
    generatedAt: input.now,
    hubVersion: input.hubVersion,
    hubMachineId: input.hubMachineId,
    sources: input.sources,
    machines,
    threads,
    accounts: input.proxy?.accounts ?? [],
    proxy: input.proxy?.status ?? null,
    secrets: input.proxy?.secrets ?? [],
  };
}
