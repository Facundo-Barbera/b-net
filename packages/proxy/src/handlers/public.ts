/**
 * Client-facing handlers (OpenAI- and Anthropic-compatible).
 *
 * Phase 1 = same-format passthrough: the body goes upstream untouched except for
 * (a) the model rewrite of a matching route and (b) stream_options.include_usage
 * on OpenAI chat streams (config routing.injectStreamUsage) so the stream can be metered.
 *
 * Failover happens only BEFORE anything is sent to the client: the response is
 * committed once an upstream answers 2xx. After that, a broken stream is recorded
 * (outcome "aborted"/"upstream-error") but never retried.
 */
import { createHash } from "node:crypto";
import { type ApiFormat, ProxyPublicRoutes, type UsageRecord } from "@fhub/core";
import { ClientAuth, presentedKey } from "../clients.ts";
import { type AccountConfig, accountBaseUrl, accountFormat, type ClientConfig } from "../config.ts";
import type { Handler, ProxyDeps } from "../deps.ts";
import { tapStream, usageFromJson, zeroUsage, type Usage } from "../metering/usage.ts";
import { type AccountRuntime, classifyStatus, type FailureInfo } from "../pool.ts";
import { computeCost, PRICING_TABLE } from "../pricing.ts";
import { endpointUpstreamFormat, TranslationNotImplemented } from "../translate.ts";
import { globMatch, iso, jsonResponse } from "../util.ts";

type Endpoint = { format: ApiFormat; path: string; metered: boolean };

const ENDPOINTS: Record<string, Endpoint> = {
  [ProxyPublicRoutes.openaiChat]: { format: "openai-chat", path: "/v1/chat/completions", metered: true },
  [ProxyPublicRoutes.openaiResponses]: { format: "openai-responses", path: "/v1/responses", metered: true },
  [ProxyPublicRoutes.anthropicMessages]: { format: "anthropic-messages", path: "/v1/messages", metered: true },
  [ProxyPublicRoutes.anthropicCountTokens]: { format: "anthropic-messages", path: "/v1/messages/count_tokens", metered: false },
};

/** Client headers forwarded upstream (allowlist). Credentials/cookies are never forwarded. */
const FORWARD_REQ_HEADERS = ["accept", "anthropic-version", "anthropic-beta", "openai-beta", "user-agent"];
/** Upstream headers returned to the client (allowlist). Rate-limit headers stay internal. */
const FORWARD_RES_HEADERS = ["content-type", "cache-control", "request-id", "x-request-id", "openai-processing-ms"];

export function errorBody(format: ApiFormat, status: number, type: string, message: string): Response {
  const body = format === "anthropic-messages" ? { type: "error", error: { type, message } } : { error: { message, type, code: type } };
  return jsonResponse(body, status);
}

interface Resolved {
  provider: string;
  upstreamModel: string;
  accountIds: string[];
}

function resolveRoute(deps: ProxyDeps, format: ApiFormat, requestedModel: string): Resolved {
  const route = deps.config.routes.find((r) => globMatch(r.match, requestedModel));
  if (route) return { provider: route.provider, upstreamModel: route.upstreamModel ?? requestedModel, accountIds: [...route.accounts] };
  return { provider: format === "anthropic-messages" ? "anthropic" : "openai", upstreamModel: requestedModel, accountIds: [] };
}

function sessionKeyOf(deps: ProxyDeps, req: Request, body: Record<string, unknown>): string | null {
  const aff = deps.config.routing.sessionAffinity;
  if (!aff.enabled) return null;
  const meta = body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : undefined;
  const raw = req.headers.get(aff.header) ?? (typeof meta?.user_id === "string" ? meta.user_id : null) ?? (typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : null);
  return raw ? createHash("sha256").update(raw).digest("hex").slice(0, 32) : null;
}

function upstreamHeaders(req: Request, account: AccountConfig, credential: string): Headers {
  const h = new Headers();
  for (const name of FORWARD_REQ_HEADERS) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  for (const [k, v] of Object.entries(account.extraHeaders)) h.set(k, v);
  h.set("content-type", "application/json");
  if (accountFormat(account) === "anthropic") {
    if (!h.has("anthropic-version")) h.set("anthropic-version", "2023-06-01");
    if (account.authKind === "api-key") h.set("x-api-key", credential);
    else h.set("authorization", `Bearer ${credential}`);
  } else {
    h.set("authorization", `Bearer ${credential}`);
  }
  return h;
}

function responseHeaders(up: Headers, extra: Record<string, string> = {}): Headers {
  const h = new Headers();
  for (const name of FORWARD_RES_HEADERS) {
    const v = up.get(name);
    if (v) h.set(name, v);
  }
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return h;
}

type Attempt =
  | { kind: "ok"; account: AccountRuntime; res: Response }
  | { kind: "client-error"; account: AccountRuntime; res: Response }
  | { kind: "exhausted"; last: { status: number; headers: Headers; body: string } | null; allRateLimited: boolean; anyPicked: boolean };

async function fetchWithHeadersTimeout(deps: ProxyDeps, url: string, init: RequestInit, clientSignal: AbortSignal | null): Promise<Response> {
  const ac = new AbortController();
  const onClientAbort = () => ac.abort(new DOMException("client aborted", "AbortError"));
  clientSignal?.addEventListener("abort", onClientAbort, { once: true });
  const timer = setTimeout(() => ac.abort(new DOMException("upstream headers timeout", "TimeoutError")), deps.config.routing.upstreamHeadersTimeoutMs);
  try {
    return await deps.fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || /timeout/i.test(err.message));
}

export function createPublicHandler(deps: ProxyDeps): Handler {
  const pricing = deps.pricing ?? PRICING_TABLE;

  function record(p: {
    startedAt: number;
    ttftMs: number | null;
    client: ClientConfig;
    format: ApiFormat;
    provider: string;
    accountId: string;
    model: string;
    requestedModel: string;
    stream: boolean;
    status: number;
    outcome: UsageRecord["outcome"];
    failedOver: string[];
    usage: Usage;
  }) {
    const cost = computeCost(p.model, p.usage, pricing);
    const now = deps.clock.now();
    const r: UsageRecord = {
      id: deps.ids(),
      ts: iso(p.startedAt),
      durationMs: Math.max(0, now - p.startedAt),
      ttftMs: p.ttftMs,
      clientId: p.client.id,
      format: p.format,
      provider: p.provider as UsageRecord["provider"],
      accountId: p.accountId,
      model: p.model,
      requestedModel: p.requestedModel,
      stream: p.stream,
      status: p.status,
      outcome: p.outcome,
      failedOver: p.failedOver,
      inputTokens: p.usage.inputTokens,
      outputTokens: p.usage.outputTokens,
      cacheReadTokens: p.usage.cacheReadTokens,
      cacheWriteTokens: p.usage.cacheWriteTokens,
      reasoningTokens: p.usage.reasoningTokens,
      costUsd: cost.costUsd,
    };
    try {
      deps.store.append(r);
    } catch (err) {
      deps.logger.log("error", "failed to append usage record", { err });
    }
  }

  async function attempt(req: Request, ep: Endpoint, resolved: Resolved, accountIds: string[], bodyText: string, sessionKey: string | null, tried: string[]): Promise<Attempt> {
    const { pool, config } = deps;
    let last: { status: number; headers: Headers; body: string } | null = null;
    let allRateLimited = true;
    let anyPicked = false;
    const exclude = new Set<string>();
    for (let i = 0; i < config.routing.maxAttempts; i++) {
      const acc = pool.pick({ provider: resolved.provider, model: resolved.upstreamModel, accountIds, exclude, sessionKey });
      if (!acc) break;
      anyPicked = true;
      exclude.add(acc.config.id);
      let credential: string;
      try {
        credential = await deps.credentials(acc.config);
      } catch (err) {
        pool.reportFailure(acc.config.id, { kind: "auth", message: "credential unavailable" });
        deps.logger.log("error", "credential unavailable", { account: acc.config.id, err });
        tried.push(acc.config.id);
        allRateLimited = false;
        continue;
      }
      const url = accountBaseUrl(acc.config, config) + ep.path;
      let res: Response;
      try {
        res = await fetchWithHeadersTimeout(deps, url, { method: "POST", headers: upstreamHeaders(req, acc.config, credential), body: bodyText }, req.signal);
      } catch (err) {
        if (req.signal?.aborted) throw err; // client left: no failover, nothing to send
        const f: FailureInfo = { kind: isTimeout(err) ? "timeout" : "network", message: err instanceof Error ? err.message : String(err) };
        pool.reportFailure(acc.config.id, f);
        deps.logger.log("warn", "upstream request failed", { account: acc.config.id, kind: f.kind, err });
        tried.push(acc.config.id);
        allRateLimited = false;
        continue;
      }
      pool.observeHeaders(acc.config.id, res.headers);
      if (res.ok) {
        pool.reportSuccess(acc.config.id);
        return { kind: "ok", account: acc, res };
      }
      const kind = classifyStatus(res.status);
      if (kind === null) return { kind: "client-error", account: acc, res };
      const body = await res.text().catch(() => "");
      pool.reportFailure(acc.config.id, { kind, status: res.status, headers: res.headers, model: resolved.upstreamModel, message: body.slice(0, 200) });
      deps.logger.log("warn", "upstream error, failing over", { account: acc.config.id, status: res.status });
      if (kind !== "rate-limited") allRateLimited = false;
      last = { status: res.status, headers: res.headers, body };
      tried.push(acc.config.id);
    }
    return { kind: "exhausted", last, allRateLimited, anyPicked };
  }

  async function handleModels(req: Request, client: ClientConfig): Promise<Response> {
    const cfg = deps.config;
    let models: Array<{ id: string; provider: string }> = cfg.models;
    if (models.length === 0) {
      const seen = new Map<string, string>();
      for (const r of cfg.routes) if (!/[*?]/.test(r.match)) seen.set(r.match, r.provider);
      for (const e of pricing.entries) {
        const hasAccount = cfg.accounts.some((a) => a.provider === e.provider && !a.disabled);
        if (hasAccount && !seen.has(e.model)) seen.set(e.model, e.provider);
      }
      models = [...seen].map(([id, provider]) => ({ id, provider }));
    }
    models = models.filter((m) => ClientAuth.allows(client, m.id));
    if (req.headers.get("anthropic-version")) {
      const data = models.map((m) => ({ type: "model", id: m.id, display_name: m.id, created_at: iso(0) }));
      return jsonResponse({ data, has_more: false, first_id: data[0]?.id ?? null, last_id: data[data.length - 1]?.id ?? null });
    }
    return jsonResponse({ object: "list", data: models.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: m.provider })) });
  }

  return async function publicHandler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const startedAt = deps.clock.now();
    const isModels = url.pathname === ProxyPublicRoutes.openaiModels;
    const ep = ENDPOINTS[url.pathname];
    if (!ep && !isModels) return errorBody("openai-chat", 404, "not_found", "unknown endpoint");
    const format: ApiFormat = ep?.format ?? (req.headers.get("anthropic-version") ? "anthropic-messages" : "openai-chat");

    const client = deps.clients.authenticate(presentedKey(req), startedAt);
    if (!client) return errorBody(format, 401, "authentication_error", "invalid or missing client key");

    if (isModels) {
      if (req.method !== "GET") return errorBody(format, 405, "method_not_allowed", "use GET");
      return handleModels(req, client);
    }
    if (req.method !== "POST") return errorBody(format, 405, "method_not_allowed", "use POST");
    const endpoint = ep!;

    let bodyText: string;
    let body: Record<string, unknown>;
    try {
      bodyText = await req.text();
      const parsed: unknown = JSON.parse(bodyText);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return errorBody(format, 400, "invalid_request_error", "body must be a JSON object");
    }
    const requestedModel = typeof body.model === "string" ? body.model : "";
    if (!requestedModel) return errorBody(format, 400, "invalid_request_error", "missing model");
    if (!ClientAuth.allows(client, requestedModel)) return errorBody(format, 403, "permission_error", `model not allowed for this client: ${requestedModel}`);

    const resolved = resolveRoute(deps, format, requestedModel);
    const wanted = endpointUpstreamFormat(format);
    const candidates = deps.pool.candidates({ provider: resolved.provider, model: resolved.upstreamModel, accountIds: resolved.accountIds });
    const compatible = candidates.filter((a) => accountFormat(a.config) === wanted);
    if (compatible.length === 0) {
      if (candidates.length > 0) {
        const err = new TranslationNotImplemented(format, accountFormat(candidates[0]!.config));
        return errorBody(format, 501, "not_implemented", err.message);
      }
      return errorBody(format, 404, "not_found_error", `no upstream account configured for model ${requestedModel}`);
    }

    const stream = body.stream === true;
    let outBody = body;
    let rewritten = false;
    if (resolved.upstreamModel !== requestedModel) {
      outBody = { ...outBody, model: resolved.upstreamModel };
      rewritten = true;
    }
    if (format === "openai-chat" && stream && deps.config.routing.injectStreamUsage) {
      const so = (body.stream_options && typeof body.stream_options === "object" ? body.stream_options : {}) as Record<string, unknown>;
      if (so.include_usage !== true) {
        outBody = { ...outBody, stream_options: { ...so, include_usage: true } };
        rewritten = true;
      }
    }
    const upstreamBody = rewritten ? JSON.stringify(outBody) : bodyText;

    const tried: string[] = [];
    const base = { startedAt, client, format, provider: resolved.provider, model: resolved.upstreamModel, requestedModel, stream };
    let result: Attempt;
    try {
      result = await attempt(
        req,
        endpoint,
        resolved,
        compatible.map((a) => a.config.id),
        upstreamBody,
        sessionKeyOf(deps, req, body),
        tried,
      );
    } catch (err) {
      deps.logger.log("info", "client aborted before upstream answered", { err });
      if (endpoint.metered) record({ ...base, ttftMs: null, accountId: tried[tried.length - 1] ?? "none", status: 499, outcome: "aborted", failedOver: tried.slice(0, -1), usage: zeroUsage() });
      return errorBody(format, 499, "client_closed_request", "client closed request");
    }

    if (result.kind === "exhausted") {
      const next = deps.pool.nextAvailableAt({ provider: resolved.provider, model: resolved.upstreamModel, accountIds: compatible.map((a) => a.config.id) });
      const now = deps.clock.now();
      const retryAfter = next !== null && next > now ? { "retry-after": String(Math.ceil((next - now) / 1000)) } : undefined;
      const outcome: UsageRecord["outcome"] = result.anyPicked && result.allRateLimited ? "rate-limited" : !result.anyPicked && next !== null ? "rate-limited" : tried.length > 1 ? "failover-exhausted" : "upstream-error";
      const status = result.last?.status ?? (outcome === "rate-limited" ? 429 : 503);
      if (endpoint.metered) record({ ...base, ttftMs: null, accountId: tried[tried.length - 1] ?? "none", status, outcome, failedOver: tried.slice(0, -1), usage: zeroUsage() });
      if (result.last) return new Response(result.last.body, { status, headers: responseHeaders(result.last.headers, retryAfter) });
      const r = errorBody(format, status, outcome === "rate-limited" ? "rate_limit_error" : "overloaded_error", "no upstream account available");
      if (retryAfter) r.headers.set("retry-after", retryAfter["retry-after"]);
      return r;
    }

    const account = result.account;
    const res = result.res;
    const commonRecord = { ...base, accountId: account.config.id, failedOver: [...tried] };

    if (result.kind === "client-error") {
      const text = await res.text().catch(() => "");
      if (endpoint.metered) record({ ...commonRecord, ttftMs: null, status: res.status, outcome: "client-error", usage: zeroUsage() });
      return new Response(text, { status: res.status, headers: responseHeaders(res.headers) });
    }

    const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
    if (isSse && res.body) {
      if (!endpoint.metered) return new Response(res.body, { status: res.status, headers: responseHeaders(res.headers) });
      const tapped = tapStream(res.body, format, () => deps.clock.now(), startedAt, (t) => {
        const outcome: UsageRecord["outcome"] = t.end === "aborted" ? "aborted" : t.end === "error" || t.streamError ? "upstream-error" : "ok";
        if (!t.sawUsage && t.end === "complete") deps.logger.log("warn", "stream finished without usage", { account: account.config.id, model: resolved.upstreamModel });
        record({ ...commonRecord, ttftMs: t.ttftMs, status: res.status, outcome, usage: t.usage });
      });
      return new Response(tapped, { status: res.status, headers: responseHeaders(res.headers) });
    }

    const text = await res.text();
    if (endpoint.metered) {
      let usage: Usage = zeroUsage();
      try {
        usage = usageFromJson(format, JSON.parse(text)) ?? usage;
      } catch {
        deps.logger.log("warn", "non-JSON upstream body", { account: account.config.id });
      }
      record({ ...commonRecord, ttftMs: Math.max(0, deps.clock.now() - startedAt), status: res.status, outcome: "ok", usage });
    }
    return new Response(text, { status: res.status, headers: responseHeaders(res.headers) });
  };
}
