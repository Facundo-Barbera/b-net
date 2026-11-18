/** Fakes for hub tests. Everything is in-memory; no network, no ports. */
import { readFileSync } from "node:fs";
import { snapshotFixture, type MachineConfig, type T3ThreadView, type UsageRecord } from "@b-net/core";
import { createBeszelClient } from "@b-net/core/clients/beszel";
import { createLocalApiSource, type LocalApiRequest } from "@b-net/core/clients/tailscale";
import { parseMachines } from "../src/config.ts";
import { createHub, type HubDeps } from "../src/hub.ts";
import { MemoryUsageStore, type UsageStore } from "../src/store.ts";

export const NOW = "2026-11-15T20:30:00.000Z";
export const minutesAgo = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();

const coreFx = (p: string) => readFileSync(new URL(`../../core/test/fixtures/${p}`, import.meta.url), "utf8");
export const machinesExample: MachineConfig[] = parseMachines(
  JSON.parse(readFileSync(new URL("../../../config/machines.example.json", import.meta.url), "utf8")),
);

export const tailscaleStatusText = coreFx("tailscale/status.json");
const pingFx = JSON.parse(coreFx("tailscale/ping-localapi.json")) as Record<string, { IP: string }>;

export const fakeLocalApi: LocalApiRequest = async (path) => {
  if (path === "/localapi/v0/status") return { status: 200, body: tailscaleStatusText };
  const ip = new URL(path, "http://x").searchParams.get("ip");
  const hit = Object.values(pingFx).find((p) => p.IP === ip);
  return hit ? { status: 200, body: JSON.stringify(hit) } : { status: 500, body: "" };
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const threadsOf = (id: string) => snapshotFixture.threads.filter((t) => t.machineId === id);
const pcMachine = snapshotFixture.machines.find((m) => m.id === "pc-bixku")!;

const AGENT_HOST_TO_MACHINE: Record<string, string> = { "bixku-mini-server": "bixku-focaltec", "bixku-pc": "pc-bixku" };

export const PROXY_TOKEN = "placeholder-proxy-token";
export const AGENT_TOKEN = "placeholder-agent-token";

export interface FakeWorld {
  /** Override per-URL responses (path+host match). */
  overrides?: Record<string, () => Response>;
  records?: UsageRecord[];
  agentMetricsAt?: string;
}

/** One fake fetch that answers for Beszel, agents, T3 exporters and the proxy. */
export function fakeFetch(world: FakeWorld = {}) {
  const systems = JSON.parse(coreFx("beszel/systems.json"));
  const stats = JSON.parse(coreFx("beszel/stats-by-system.json")) as Record<string, unknown>;
  const records = [...(world.records ?? snapshotFixture.proxy!.recent)].sort((a, b) => (a.id < b.id ? -1 : 1));
  const calls: string[] = [];
  const f = async (input: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(input);
    const key = `${u.host}${u.pathname}`;
    calls.push(key);
    const o = world.overrides?.[key];
    if (o) return o();
    const auth = new Headers(init?.headers).get("authorization");

    if (u.host === "beszel.invalid") {
      if (u.pathname.endsWith("/auth-with-password")) return json({ token: "FAKE-TOKEN", record: { id: "u1" } });
      if (u.pathname === "/api/collections/systems/records") return json(systems);
      const id = /system='([^']+)'/.exec(u.searchParams.get("filter") ?? "")?.[1] ?? "";
      return json(stats[id] ?? { page: 1, perPage: 30, totalItems: 0, totalPages: 0, items: [] });
    }

    if (u.host === "proxy.invalid") {
      if (auth !== `Bearer ${PROXY_TOKEN}`) return json({ error: "unauthorized" }, 401);
      switch (u.pathname) {
        case "/internal/v1/status":
          return json(snapshotFixture.proxy);
        case "/internal/v1/accounts":
          return json({ accounts: snapshotFixture.accounts });
        case "/internal/v1/secrets":
          // A misbehaving upstream that adds a value field: the hub must drop it.
          return json({ secrets: [...snapshotFixture.secrets.slice(0, 2).map((s, i) => (i === 0 ? { ...s, value: "sk-ant-FAKE-should-never-leak" } : s)), ...snapshotFixture.secrets.slice(2)] });
        case "/internal/v1/records": {
          const since = u.searchParams.get("since");
          const limit = Number(u.searchParams.get("limit") ?? 500);
          const after = records.filter((r) => !since || r.id > since);
          const page = after.slice(0, limit);
          return json({ records: page, nextCursor: after.length > limit ? page.at(-1)!.id : null });
        }
      }
      return json({}, 404);
    }

    if (u.port === "8781") {
      if (auth !== `Bearer ${AGENT_TOKEN}`) return json({ error: "unauthorized" }, 401);
      // Agents are addressed by Tailscale host (machines.example.json agentUrl), not by machine id.
      const machine = AGENT_HOST_TO_MACHINE[u.hostname] ?? u.hostname;
      if (u.pathname === "/agent/v1/t3/threads") {
        // agents report their own machineId; vps lies on purpose to test that config binding wins
        const list: T3ThreadView[] = threadsOf(machine).map((t) => (machine === "bixku-vps" ? { ...t, machineId: "wrong-id" } : t));
        return json({ threads: list });
      }
      if (u.pathname === "/agent/v1/metrics") {
        if (machine === "pc-bixku")
          return json({ machineId: "pc-bixku", at: world.agentMetricsAt ?? minutesAgo(1), metrics: pcMachine.metrics, history: pcMachine.history });
        if (machine === "bixku-vps") return json({ error: "down" }, 503);
        return json({}, 404);
      }
    }
    return json({}, 404);
  };
  return { fetch: f, calls };
}

export function buildHub(opts: { world?: FakeWorld; store?: UsageStore; deps?: Partial<HubDeps>; now?: () => Date } = {}) {
  const { fetch, calls } = fakeFetch(opts.world);
  const hub = createHub({
    machines: machinesExample,
    hubMachineId: "bixku-homelab",
    fetch,
    clock: opts.now ?? (() => new Date(NOW)),
    tailscale: createLocalApiSource({ request: fakeLocalApi }),
    beszel: createBeszelClient({ baseUrl: "http://beszel.invalid", email: "hub@example.invalid", password: "placeholder", fetch }),
    agentToken: AGENT_TOKEN,
    // bixku-mbp has no agentUrl in config: its T3 exporter is listed separately (T3_EXPORTERS)
    t3Exporters: ["http://bixku-mbp:8781"],
    proxy: { url: "http://proxy.invalid", token: PROXY_TOKEN },
    store: opts.store ?? new MemoryUsageStore(),
    ...opts.deps,
  });
  return { hub, calls };
}
