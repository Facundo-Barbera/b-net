/**
 * Internal API pulled by the hub (`ProxyInternalRoutes`). Bearer admin token,
 * constant-time compare. Read-only. Never returns secret values: secrets go
 * through the strict SecretMeta schema, clients through ClientKeyView (no hash).
 */
import { AccountView, ClientKeyView, ProxyInternalRoutes, ProxyStatus, SecretMeta, type UsageWindow } from "@fhub/core";
import type { Handler, ProxyDeps } from "../deps.ts";
import { addToTotals, emptyTotals } from "../store/records.ts";
import { iso, jsonResponse, percentile, safeEqual } from "../util.ts";

const DAY = 86400_000;

export function buildAccountViews(deps: ProxyDeps): AccountView[] {
  const now = deps.clock.now();
  const midnight = Math.floor(now / DAY) * DAY; // UTC day
  return [...deps.pool.accounts.values()].map((a) => {
    const id = a.config.id;
    const windows: UsageWindow[] = a.windows.map((w) => ({
      ...w,
      totals: w.startedAt ? deps.store.totals({ accountId: id, fromMs: Date.parse(w.startedAt) }) : emptyTotals(),
    }));
    const state = deps.pool.stateOf(id);
    return AccountView.parse({
      id,
      provider: a.config.provider,
      label: a.config.label,
      plan: a.config.plan,
      planPriceUsd: a.config.planPriceUsd,
      authKind: a.config.authKind,
      poolState: state,
      cooldownUntil: state === "cooldown" && a.cooldownUntil !== null ? iso(a.cooldownUntil) : null,
      priority: a.config.priority,
      lastUsedAt: a.lastUsedAt !== null ? iso(a.lastUsedAt) : null,
      lastError: a.lastError,
      windows,
      credits: null,
      today: deps.store.totals({ accountId: id, fromMs: midnight }),
      last7d: deps.store.totals({ accountId: id, fromMs: now - 7 * DAY }),
      last30d: deps.store.totals({ accountId: id, fromMs: now - 30 * DAY }),
    });
  });
}

export function buildStatus(deps: ProxyDeps): ProxyStatus {
  const now = deps.clock.now();
  const hour = deps.store.sinceTs(now - 3600_000);
  const durations = hour.map((r) => r.durationMs).sort((x, y) => x - y);
  const t = emptyTotals();
  for (const r of hour) addToTotals(t, r);
  return ProxyStatus.parse({
    version: deps.version,
    listen: `${deps.config.listen.host}:${deps.config.listen.port}`,
    startedAt: iso(deps.startedAt),
    legacyProxy: { name: "CLIProxyAPI", listen: deps.config.legacyProxy.listen, retired: deps.config.legacyProxy.retired },
    lastHour: {
      requests: hour.length,
      errors: hour.filter((r) => r.outcome !== "ok" && r.outcome !== "client-error").length,
      rateLimited: hour.filter((r) => r.outcome === "rate-limited").length,
      failovers: hour.filter((r) => r.failedOver.length > 0).length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      costUsd: t.costUsd,
    },
    routes: deps.config.routes,
    clients: deps.clients.views(),
    recent: deps.store.recent(50),
  });
}

export function createInternalHandler(deps: ProxyDeps): Handler {
  if (deps.adminToken.length < 16) throw new Error("admin token must be at least 16 characters");
  return async function internalHandler(req: Request): Promise<Response> {
    const auth = req.headers.get("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!m || !safeEqual(m[1]!.trim(), deps.adminToken)) return jsonResponse({ error: "unauthorized" }, 401);
    if (req.method !== "GET") return jsonResponse({ error: "method not allowed" }, 405);
    const url = new URL(req.url);
    switch (url.pathname) {
      case ProxyInternalRoutes.status:
        return jsonResponse(buildStatus(deps));
      case ProxyInternalRoutes.accounts:
        return jsonResponse({ accounts: buildAccountViews(deps) });
      case ProxyInternalRoutes.records: {
        const since = url.searchParams.get("since");
        if (since !== null && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(since)) return jsonResponse({ error: "since must be a ULID" }, 400);
        const limitRaw = Number(url.searchParams.get("limit") ?? 100);
        const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, Math.floor(limitRaw))) : 100;
        return jsonResponse(deps.store.page(since, limit));
      }
      case ProxyInternalRoutes.secrets:
        return jsonResponse({ secrets: deps.secrets.listMeta().map((s) => SecretMeta.parse(s)) });
      case ProxyInternalRoutes.clients:
        return jsonResponse({ clients: deps.clients.views().map((c) => ClientKeyView.strict().parse(c)) });
      default:
        return jsonResponse({ error: "not found" }, 404);
    }
  };
}
