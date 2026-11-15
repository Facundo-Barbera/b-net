import { z } from "zod";
import { IsoTime, MachineMetrics, MachineView, MetricHistory } from "./machines.ts";
import { T3ThreadView } from "./threads.ts";
import { AccountView } from "./usage.ts";
import { ProxyStatus, UsageRecord, ClientKeyView } from "./proxy.ts";
import { SecretMeta } from "./secrets.ts";

/* ------------------------------------------------------------------ *
 * Health of each data source the hub aggregates.
 * ------------------------------------------------------------------ */
export const SourceHealth = z.object({
  source: z.enum(["beszel", "tailscale", "t3", "proxy", "agent"]),
  /** For per-machine sources (agent, t3), the machine id. */
  machineId: z.string().nullable(),
  ok: z.boolean(),
  lastSuccessAt: IsoTime.nullable(),
  error: z.string().nullable(),
});
export type SourceHealth = z.infer<typeof SourceHealth>;

/** Everything the UI needs in one payload. GET /api/v1/snapshot */
export const HubSnapshot = z.object({
  generatedAt: IsoTime,
  hubVersion: z.string(),
  hubMachineId: z.string(), // "bixku-homelab": center of the topology map
  sources: z.array(SourceHealth),
  machines: z.array(MachineView),
  threads: z.array(T3ThreadView),
  accounts: z.array(AccountView),
  proxy: ProxyStatus.nullable(),
  secrets: z.array(SecretMeta),
});
export type HubSnapshot = z.infer<typeof HubSnapshot>;

/* ------------------------------------------------------------------ *
 * Hub HTTP API (served by @bixku/hub, consumed by @bixku/web).
 * All under /api/v1, JSON, read-only in phase 1. Auth: Tailscale-only bind
 * + optional `Authorization: Bearer <hub token>` (see architecture.md).
 * ------------------------------------------------------------------ */
export const HubRoutes = {
  snapshot: "/api/v1/snapshot", // HubSnapshot
  machines: "/api/v1/machines", // { machines: MachineView[] }
  machine: "/api/v1/machines/:id", // MachineView
  threads: "/api/v1/threads", // ?machine=&state= -> { threads: T3ThreadView[] }
  accounts: "/api/v1/usage/accounts", // { accounts: AccountView[] }
  usageRecords: "/api/v1/usage/records", // ?since=<ulid>&account=&limit= -> UsageRecordsPage
  proxyStatus: "/api/v1/proxy/status", // ProxyStatus
  secrets: "/api/v1/secrets", // { secrets: SecretMeta[] } (metadata only)
  health: "/api/v1/health", // { ok: true, sources: SourceHealth[] }
} as const;

export const UsageRecordsPage = z.object({
  records: z.array(UsageRecord),
  /** Pass as ?since= to get the next page; null = caught up. */
  nextCursor: z.string().nullable(),
});
export type UsageRecordsPage = z.infer<typeof UsageRecordsPage>;

/* ------------------------------------------------------------------ *
 * Proxy internal API (served by @bixku/proxy on its Tailscale IP,
 * pulled by the hub). Auth: `Authorization: Bearer <proxy admin token>`.
 * Never returns secret values.
 * ------------------------------------------------------------------ */
export const ProxyInternalRoutes = {
  status: "/internal/v1/status", // ProxyStatus
  accounts: "/internal/v1/accounts", // { accounts: AccountView[] }
  records: "/internal/v1/records", // ?since=&limit= -> UsageRecordsPage
  secrets: "/internal/v1/secrets", // { secrets: SecretMeta[] }
  clients: "/internal/v1/clients", // { clients: ClientKeyView[] }
} as const;

/** Client-facing proxy endpoints (same shapes as the upstream APIs). */
export const ProxyPublicRoutes = {
  openaiChat: "/v1/chat/completions",
  openaiResponses: "/v1/responses",
  openaiModels: "/v1/models",
  anthropicMessages: "/v1/messages",
  anthropicCountTokens: "/v1/messages/count_tokens",
} as const;

/* ------------------------------------------------------------------ *
 * Agent API (served by @bixku/agent on each machine's Tailscale IP,
 * pulled by the hub). Auth: `Authorization: Bearer <agent token>`.
 * ------------------------------------------------------------------ */
export const AgentRoutes = {
  health: "/agent/v1/health", // AgentHealth
  metrics: "/agent/v1/metrics", // AgentMetrics
  t3Threads: "/agent/v1/t3/threads", // { threads: T3ThreadView[] } (machineId filled by agent)
} as const;

export const AgentHealth = z.object({
  machineId: z.string(),
  version: z.string(),
  startedAt: IsoTime,
  t3Available: z.boolean(),
});
export type AgentHealth = z.infer<typeof AgentHealth>;

export const AgentMetrics = z.object({
  machineId: z.string(),
  at: IsoTime,
  metrics: MachineMetrics,
  history: MetricHistory.nullable(),
});
export type AgentMetrics = z.infer<typeof AgentMetrics>;

export const AgentThreads = z.object({ threads: z.array(T3ThreadView) });
export type AgentThreads = z.infer<typeof AgentThreads>;

export { ClientKeyView };
