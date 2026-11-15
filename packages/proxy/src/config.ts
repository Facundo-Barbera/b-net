/**
 * Proxy configuration: JSON, validated with zod.
 *
 * Why JSON (not YAML): Node has no built-in YAML parser and we avoid new
 * dependencies; JSON matches config/machines.example.json; zod gives precise
 * errors. Comments go in keys starting with "$" (e.g. "$comment"), which are
 * stripped before validation.
 *
 * The config contains NO secret values, only secret ids that refer to entries
 * in the encrypted secret store (secrets.enc).
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ProviderId, AuthKind, ModelRoute, ClientKeyView } from "@b-net/core";

export const UpstreamFormat = z.enum(["openai", "anthropic"]);
export type UpstreamFormat = z.infer<typeof UpstreamFormat>;

export const AccountConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  provider: ProviderId,
  label: z.string(),
  plan: z.string().default("unknown"),
  planPriceUsd: z.number().nonnegative().nullable().default(null),
  authKind: AuthKind,
  /** Lower = preferred. Accounts of the lowest priority tier are used first. */
  priority: z.number().int().default(0),
  /** "standby" accounts only receive traffic when no "active" account is eligible. */
  role: z.enum(["active", "standby"]).default("active"),
  disabled: z.boolean().default(false),
  /** Id of the credential in the secret store. */
  secretId: z.string(),
  /** Overrides the provider base URL (e.g. OpenRouter, a regional endpoint). */
  baseUrl: z.string().url().optional(),
  /** Wire format of this upstream. Default derived from provider (anthropic -> anthropic, else openai). */
  format: UpstreamFormat.optional(),
  /** Globs of models this account serves. Empty = any. */
  models: z.array(z.string()).default([]),
  /** Non-secret extra headers sent upstream (e.g. OpenRouter attribution). */
  extraHeaders: z.record(z.string(), z.string()).default({}),
});
export type AccountConfig = z.infer<typeof AccountConfig>;

export const ClientConfig = ClientKeyView.omit({ lastUsedAt: true }).extend({
  /** hex HMAC-SHA256(pepper, key). Generate with scripts/hash-client-key.ts. */
  keyHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type ClientConfig = z.infer<typeof ClientConfig>;

export const ProxyConfig = z.object({
  listen: z.object({ host: z.string(), port: z.number().int().min(1).max(65535) }),
  legacyProxy: z.object({ listen: z.string(), retired: z.boolean() }).default({ listen: "127.0.0.1:8317", retired: false }),
  secrets: z.object({
    file: z.string(),
    masterKeyFile: z.string(),
    /** Secret ids for proxy-internal secrets. */
    adminTokenId: z.string().default("proxy-admin-token"),
    clientKeyPepperId: z.string().default("client-key-pepper"),
  }),
  records: z.object({ sqlitePath: z.string() }),
  machineId: z.string().default("bixku-homelab"),
  routing: z
    .object({
      strategy: z.enum(["round-robin", "fill-first"]).default("round-robin"),
      sessionAffinity: z
        .object({
          enabled: z.boolean().default(false),
          ttlSec: z.number().int().positive().default(3600),
          header: z.string().default("x-session-id"),
        })
        .prefault({}),
      /** Max upstream attempts per request (failover chain length). */
      maxAttempts: z.number().int().min(1).max(16).default(4),
      /** Timeout until upstream response HEADERS arrive. Streams are not cut by it. */
      upstreamHeadersTimeoutMs: z.number().int().positive().default(120_000),
      cooldown: z
        .object({
          backoffBaseMs: z.number().int().positive().default(1_000),
          backoffMaxMs: z.number().int().positive().default(30 * 60_000),
          serverErrorMs: z.number().int().positive().default(60_000),
          modelNotFoundMs: z.number().int().positive().default(12 * 3600_000),
        })
        .prefault({}),
      /** Ask OpenAI-format upstreams for a final usage chunk (stream_options.include_usage). */
      injectStreamUsage: z.boolean().default(true),
    })
    .prefault({}),
  providers: z
    .partialRecord(ProviderId, z.object({ baseUrl: z.string().url() }))
    .default({}),
  accounts: z.array(AccountConfig).default([]),
  routes: z.array(ModelRoute).default([]),
  clients: z.array(ClientConfig).default([]),
  /** Models advertised on GET /v1/models. Empty = literal route matches + priced models. */
  models: z.array(z.object({ id: z.string(), provider: ProviderId })).default([]),
});
export type ProxyConfig = z.infer<typeof ProxyConfig>;

export const DEFAULT_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  openrouter: "https://openrouter.ai/api",
};

function stripComments(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (!k.startsWith("$")) o[k] = stripComments(val);
    return o;
  }
  return v;
}

export function parseConfig(raw: unknown): ProxyConfig {
  const r = ProxyConfig.safeParse(stripComments(raw));
  if (!r.success) {
    const msg = r.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid proxy config: ${msg}`);
  }
  const cfg = r.data;
  const ids = new Set<string>();
  for (const a of cfg.accounts) {
    if (ids.has(a.id)) throw new Error(`invalid proxy config: duplicate account id ${a.id}`);
    ids.add(a.id);
  }
  for (const route of cfg.routes) for (const id of route.accounts) if (!ids.has(id)) throw new Error(`invalid proxy config: route ${route.match} references unknown account ${id}`);
  return cfg;
}

export function loadConfig(path: string): ProxyConfig {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function accountFormat(a: AccountConfig): UpstreamFormat {
  return a.format ?? (a.provider === "anthropic" ? "anthropic" : "openai");
}

export function accountBaseUrl(a: AccountConfig, cfg: ProxyConfig): string {
  const url = a.baseUrl ?? cfg.providers[a.provider]?.baseUrl ?? DEFAULT_BASE_URLS[a.provider];
  if (!url) throw new Error(`no base URL for account ${a.id} (provider ${a.provider})`);
  return url.replace(/\/+$/, "");
}
