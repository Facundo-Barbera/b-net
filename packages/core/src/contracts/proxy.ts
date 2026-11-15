import { z } from "zod";
import { IsoTime } from "./machines.ts";
import { ProviderId } from "./usage.ts";

/** Client-facing API surface a request came through. */
export const ApiFormat = z.enum(["openai-chat", "openai-responses", "anthropic-messages"]);
export type ApiFormat = z.infer<typeof ApiFormat>;

/**
 * One metered request. Written by the proxy (append-only), pulled by the hub.
 * MUST NOT contain prompts, completions, headers or any credential.
 */
export const UsageRecord = z.object({
  id: z.string(), // ULID, monotonic -> usable as cursor
  ts: IsoTime, // request start
  durationMs: z.number().int().nonnegative(),
  ttftMs: z.number().int().nonnegative().nullable(),
  clientId: z.string(), // id of the client key (never the key)
  format: ApiFormat,
  provider: ProviderId,
  accountId: z.string(),
  model: z.string(), // model actually sent upstream
  requestedModel: z.string(), // model the client asked for (before aliasing)
  stream: z.boolean(),
  status: z.number().int(), // final HTTP status returned to client
  outcome: z.enum(["ok", "client-error", "upstream-error", "rate-limited", "failover-exhausted", "aborted"]),
  /** Accounts tried before success (failover chain), excluding accountId. */
  failedOver: z.array(z.string()),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative(),
  /** List-price cost in USD; null when the model has no price entry. */
  costUsd: z.number().nonnegative().nullable(),
});
export type UsageRecord = z.infer<typeof UsageRecord>;

export const ClientKeyView = z.object({
  id: z.string(),
  label: z.string(), // e.g. "t3-vps", "opencode-mbp"
  createdAt: IsoTime,
  lastUsedAt: IsoTime.nullable(),
  /** Glob patterns; empty = all models. */
  allowedModels: z.array(z.string()),
  /** Whether this client is migrated to bixku-proxy or still on CLIProxyAPI. */
  migration: z.enum(["cliproxyapi", "bixku-proxy", "both"]),
});
export type ClientKeyView = z.infer<typeof ClientKeyView>;

export const ModelRoute = z.object({
  /** Pattern the client sends, e.g. "claude-opus-5-5" or "gpt-*". */
  match: z.string(),
  provider: ProviderId,
  /** Optional rewrite of the upstream model id. */
  upstreamModel: z.string().nullable(),
  /** Account ids eligible, in pool order. Empty = all accounts of provider. */
  accounts: z.array(z.string()),
});
export type ModelRoute = z.infer<typeof ModelRoute>;

export const ProxyStatus = z.object({
  version: z.string(),
  listen: z.string(), // "100.x.y.z:8318"
  startedAt: IsoTime,
  /** Is CLIProxyAPI still running side by side (as configured, not probed). */
  legacyProxy: z.object({ name: z.literal("CLIProxyAPI"), listen: z.string(), retired: z.boolean() }),
  lastHour: z.object({
    requests: z.number().int(),
    errors: z.number().int(),
    rateLimited: z.number().int(),
    failovers: z.number().int(),
    p50Ms: z.number().nullable(),
    p95Ms: z.number().nullable(),
    costUsd: z.number(),
  }),
  routes: z.array(ModelRoute),
  clients: z.array(ClientKeyView),
  /** Most recent records, newest first (bounded, e.g. 50). */
  recent: z.array(UsageRecord),
});
export type ProxyStatus = z.infer<typeof ProxyStatus>;
