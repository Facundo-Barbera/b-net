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
 * Hub HTTP API (served by @fhub/hub, consumed by @fhub/web).
 * All under /api/v1, JSON. Auth: Tailscale-only bind. Reads: optional
 * `Authorization: Bearer <hub token>` (a bot token also works). Writes (POST):
 * always `Authorization: Bearer <bot token>`; the bot is the author.
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
  work: "/api/v1/work", // WorkSnapshot (contracts/work.ts)
  projects: "/api/v1/projects", // GET -> { projects: ProjectSummary[] }; POST ProjectInput -> 201 Project
  project: "/api/v1/projects/:id", // ProjectSummary
  deliverables: "/api/v1/projects/:id/deliverables", // GET -> { deliverables: Deliverable[] }; POST raw body ?DeliverableUploadQuery -> 201 Deliverable
  deliverable: "/api/v1/projects/:id/deliverables/:deliverableId", // Deliverable
  deliverableContent: "/api/v1/projects/:id/deliverables/:deliverableId/content", // file bytes (Range ok, ?download=1)
} as const;

export const UsageRecordsPage = z.object({
  records: z.array(UsageRecord),
  /** Pass as ?since= to get the next page; null = caught up. */
  nextCursor: z.string().nullable(),
});
export type UsageRecordsPage = z.infer<typeof UsageRecordsPage>;

/* ------------------------------------------------------------------ *
 * Proxy internal API (served by @fhub/proxy on its Tailscale IP,
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
 * Agent API (served by @fhub/agent on each machine's Tailscale IP,
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

/* ------------------------------------------------------------------ *
 * Push ingestion (agent -> hub). The agent opens no port: every
 * interval it POSTs one sample. Auth: `Authorization: Bearer <machine
 * token>`; the hub keeps only sha256(token) and the machine it belongs to.
 * The hub timestamps samples with its own clock (agent clocks may drift).
 * ------------------------------------------------------------------ */
export const IngestRoutes = {
  metrics: "/ingest/v1/metrics", // POST AgentMetricsPush -> 204
} as const;

/** Upper bound for an ingest request body; a real sample is ~400 bytes. */
export const INGEST_MAX_BYTES = 8 * 1024;

export const AgentMetricsPush = z
  .object({
    /** Must match the machine the token was issued for. */
    machineId: z.string().regex(/^[a-z0-9-]+$/).max(64),
    agentVersion: z.string().max(32),
    metrics: MachineMetrics.strict(),
  })
  .strict();
export type AgentMetricsPush = z.infer<typeof AgentMetricsPush>;

export { ClientKeyView };
