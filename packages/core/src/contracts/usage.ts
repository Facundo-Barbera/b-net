import { z } from "zod";
import { IsoTime } from "./machines.ts";

export const ProviderId = z.enum(["anthropic", "openai", "google", "openrouter", "other"]);
export type ProviderId = z.infer<typeof ProviderId>;

/** How the proxy authenticates upstream for this account. */
export const AuthKind = z.enum(["oauth-subscription", "api-key"]);
export type AuthKind = z.infer<typeof AuthKind>;

/**
 * Pool state of an account inside the proxy:
 * - active:   receives traffic
 * - standby:  healthy, used only when actives are exhausted (failover)
 * - cooldown: hit a limit; skipped until cooldownUntil
 * - disabled: manually turned off
 * - error:    auth failure / needs re-login
 */
export const PoolState = z.enum(["active", "standby", "cooldown", "disabled", "error"]);
export type PoolState = z.infer<typeof PoolState>;

export const UsageTotals = z.object({
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  /** Cost at public list price (USD), whatever was actually billed. */
  costUsd: z.number().nonnegative(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

export const UsageWindow = z.object({
  kind: z.enum(["5h", "weekly", "monthly"]),
  /** Optional sub-label, e.g. "opus" for a model-specific weekly cap. */
  scope: z.string().nullable(),
  startedAt: IsoTime.nullable(),
  resetsAt: IsoTime.nullable(),
  /** 0-100 as reported by the provider, or null when unknown. */
  usedPct: z.number().min(0).max(100).nullable(),
  /**
   * provider-headers: parsed from upstream rate-limit headers (authoritative)
   * estimated:        computed from our own metering vs a configured budget
   * manual:           typed in by Facundo
   */
  source: z.enum(["provider-headers", "estimated", "manual"]),
  totals: UsageTotals,
});
export type UsageWindow = z.infer<typeof UsageWindow>;

export const Credits = z.object({
  currency: z.string().default("USD"),
  balance: z.number().nullable(),
  granted: z.number().nullable(),
  spent: z.number().nullable(),
  expiresAt: IsoTime.nullable(),
  source: z.enum(["provider-api", "manual", "estimated"]),
  updatedAt: IsoTime.nullable(),
});
export type Credits = z.infer<typeof Credits>;

export const AccountView = z.object({
  id: z.string(), // stable, non-secret slug, e.g. "anthropic-max-1"
  provider: ProviderId,
  label: z.string(),
  /** Plan name, e.g. "Claude Max 20x", "ChatGPT Pro", "API pay-as-you-go". */
  plan: z.string(),
  /** Nominal monthly price of the subscription in USD (0 for pay-as-you-go). */
  planPriceUsd: z.number().nonnegative().nullable(),
  authKind: AuthKind,
  poolState: PoolState,
  cooldownUntil: IsoTime.nullable(),
  /** Lower = preferred. */
  priority: z.number().int(),
  lastUsedAt: IsoTime.nullable(),
  lastError: z.string().nullable(),
  windows: z.array(UsageWindow),
  credits: Credits.nullable(),
  today: UsageTotals,
  last7d: UsageTotals,
  last30d: UsageTotals,
});
export type AccountView = z.infer<typeof AccountView>;
