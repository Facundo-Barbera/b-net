/**
 * Hub runtime: owns one SourceTracker per source, runs poll cycles (on demand or on timers)
 * and builds the HubSnapshot from fresh data. All I/O is injected so tests drive it with fakes.
 */
import type { AgentMetrics, HubSnapshot, MachineConfig, T3ThreadView } from "@bixku/core";
import type { BeszelClient, BeszelMachine } from "@bixku/core/clients/beszel";
import type { PingOutcome, TailscaleSource, TailscaleStatus } from "@bixku/core/clients/tailscale";
import { aggregate } from "./aggregate.ts";
import { SourceTracker, type Clock } from "./health.ts";
import { fetchAgentMetrics, fetchAgentThreads, fetchProxy, ingestUsage, pollTailscale, type FetchLike } from "./sources.ts";
import type { StatusThresholds } from "./status.ts";
import type { UsageStore } from "./store.ts";

export const HUB_VERSION = "0.1.0";

export interface HubDeps {
  machines: MachineConfig[];
  hubMachineId: string;
  fetch: FetchLike;
  clock?: Clock;
  tailscale: TailscaleSource | null;
  beszel: BeszelClient | null;
  /** Agent base URLs per machine id (from machines[].agentUrl). */
  agentToken?: string | null;
  /** Extra T3 exporter URLs not bound to a machine in config. */
  t3Exporters?: string[];
  proxy?: { url: string; token: string | null } | null;
  store: UsageStore;
  pollFastSec?: number;
  pollAgentSec?: number;
  thresholds?: StatusThresholds;
}

type ProxyData = Awaited<ReturnType<typeof fetchProxy>>;

export interface Hub {
  /** Run every poller once (fast + agent sources). */
  pollAll(): Promise<void>;
  pollFast(): Promise<void>;
  pollAgents(): Promise<void>;
  snapshot(): HubSnapshot;
  readonly store: UsageStore;
  /** Start interval timers (only used by serve.ts). Returns a stop function. */
  start(): () => void;
}

export function createHub(deps: HubDeps): Hub {
  const clock = deps.clock ?? (() => new Date());
  const fastMs = (deps.pollFastSec ?? 15) * 1000;
  const agentMs = (deps.pollAgentSec ?? 30) * 1000;
  // Data older than 3 cycles is treated as absent.
  const fastMaxAge = fastMs * 3;
  const agentMaxAge = agentMs * 3;

  const tailscale = deps.tailscale ? new SourceTracker<{ status: TailscaleStatus; pings: Record<string, PingOutcome> }>("tailscale", null, clock) : null;
  const beszel = deps.beszel ? new SourceTracker<BeszelMachine[]>("beszel", null, clock) : null;
  const proxy = deps.proxy ? new SourceTracker<ProxyData>("proxy", null, clock) : null;

  const agentTargets = deps.machines.filter((m) => m.agentUrl).map((m) => ({ machineId: m.id, url: m.agentUrl!.replace(/\/+$/, "") }));
  const agents = agentTargets.map((a) => ({
    ...a,
    metrics: new SourceTracker<AgentMetrics>("agent", a.machineId, clock),
    threads: new SourceTracker<T3ThreadView[]>("t3", a.machineId, clock),
  }));
  const exporters = (deps.t3Exporters ?? []).map((url) => ({ url, threads: new SourceTracker<T3ThreadView[]>("t3", null, clock) }));

  async function pollFast() {
    await Promise.all([
      tailscale?.run(() => pollTailscale(deps.tailscale!, deps.machines)),
      beszel?.run(() => deps.beszel!.fetchMachines()),
      proxy?.run(async () => {
        const data = await fetchProxy(deps.fetch, deps.proxy!.url, deps.proxy!.token);
        // Usage ingestion piggybacks on the proxy cycle; its failure marks the proxy source unhealthy.
        await ingestUsage(deps.fetch, deps.proxy!.url, deps.proxy!.token, deps.store);
        return data;
      }),
    ]);
  }

  async function pollAgents() {
    const token = deps.agentToken ?? null;
    await Promise.all([
      ...agents.flatMap((a) => [
        a.metrics.run(() => fetchAgentMetrics(deps.fetch, a.url, token)),
        // The hub trusts its own config for machine binding, not the agent's claim.
        a.threads.run(async () => (await fetchAgentThreads(deps.fetch, a.url, token)).map((t) => ({ ...t, machineId: a.machineId }))),
      ]),
      ...exporters.map((e) => e.threads.run(() => fetchAgentThreads(deps.fetch, e.url, token))),
    ]);
  }

  function snapshot(): HubSnapshot {
    const agentMetrics: Record<string, AgentMetrics> = {};
    const threads: T3ThreadView[] = [];
    const seen = new Set<string>();
    for (const a of agents) {
      const m = a.metrics.fresh(agentMaxAge);
      if (m) agentMetrics[a.machineId] = m;
    }
    for (const list of [...agents.map((a) => a.threads.fresh(agentMaxAge)), ...exporters.map((e) => e.threads.fresh(agentMaxAge))]) {
      for (const t of list ?? []) {
        const key = `${t.machineId}/${t.id}`;
        if (!seen.has(key)) (seen.add(key), threads.push(t));
      }
    }
    const sources = [
      tailscale?.health(),
      beszel?.health(),
      proxy?.health(),
      ...agents.flatMap((a) => [a.metrics.health(), a.threads.health()]),
      ...exporters.map((e) => e.threads.health()),
    ].filter((s) => s !== undefined);

    return aggregate({
      now: clock().toISOString(),
      hubVersion: HUB_VERSION,
      hubMachineId: deps.hubMachineId,
      machines: deps.machines,
      tailscale: tailscale?.fresh(fastMaxAge) ?? null,
      beszel: beszel?.fresh(fastMaxAge) ?? null,
      agentMetrics,
      threads,
      proxy: proxy?.fresh(fastMaxAge) ?? null,
      sources,
      thresholds: deps.thresholds,
    });
  }

  function start() {
    let stopped = false;
    const loop = (fn: () => Promise<void>, ms: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = async () => {
        await fn().catch(() => undefined);
        if (!stopped) timer = setTimeout(tick, ms);
      };
      void tick();
      return () => clearTimeout(timer);
    };
    const stops = [loop(pollFast, fastMs), loop(pollAgents, agentMs)];
    return () => {
      stopped = true;
      stops.forEach((s) => s());
    };
  }

  return {
    pollAll: async () => void (await Promise.all([pollFast(), pollAgents()])),
    pollFast,
    pollAgents,
    snapshot,
    store: deps.store,
    start,
  };
}
