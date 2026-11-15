/**
 * Tolerant parsers for upstream rate-limit headers.
 *
 * ⚠ ASSUMED FORMATS. Only the API-key `anthropic-ratelimit-{requests,tokens,
 * input-tokens,output-tokens}-{limit,remaining,reset}` headers are publicly
 * documented (per-minute limits, reset as RFC 3339). The subscription headers
 * (`anthropic-ratelimit-unified-*` and Codex `x-codex-*`) are NOT documented;
 * the shapes below are best guesses, tested only with synthetic fixtures.
 * Anything unparseable is ignored rather than throwing.
 */
import type { UsageWindow } from "@bixku/core";
import { iso } from "./util.ts";

type HeaderBag = Headers | Record<string, string | undefined>;

function get(h: HeaderBag, name: string): string | undefined {
  if (h instanceof Headers) return h.get(name) ?? undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

function entries(h: HeaderBag): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (h instanceof Headers) h.forEach((v, k) => out.push([k.toLowerCase(), v]));
  else for (const [k, v] of Object.entries(h)) if (v !== undefined) out.push([k.toLowerCase(), v]);
  return out;
}

/** Accepts epoch seconds, epoch ms, or an ISO/HTTP date. Returns ms or null. */
export function parseResetTime(v: string | undefined, nowMs: number): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 1e12) return Math.round(n); // epoch ms
    if (n > 1e9) return Math.round(n * 1000); // epoch seconds
    return nowMs + Math.round(n * 1000); // small number: relative seconds
  }
  const d = Date.parse(s);
  return Number.isNaN(d) ? null : d;
}

/** 0..1 fraction or 0..100 percent -> 0..100 (clamped). */
export function parsePct(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v.trim().replace(/%$/, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  const pct = n <= 1 && !v.includes("%") && !/^\d+$/.test(v.trim()) ? n * 100 : n;
  return Math.min(100, Math.round(pct * 100) / 100);
}

/** Parse `Retry-After` (seconds or HTTP date) to an absolute ms timestamp. */
export function parseRetryAfter(v: string | undefined, nowMs: number): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return nowMs + Math.round(Number(s) * 1000);
  const d = Date.parse(s);
  return Number.isNaN(d) ? null : d;
}

const EMPTY_TOTALS = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
const H5 = 5 * 3600_000;
const D7 = 7 * 86400_000;

function windowOf(kind: UsageWindow["kind"], scope: string | null, usedPct: number | null, resetsAt: number | null): UsageWindow {
  const len = kind === "5h" ? H5 : kind === "weekly" ? D7 : null;
  return {
    kind,
    scope,
    startedAt: resetsAt !== null && len !== null ? iso(resetsAt - len) : null,
    resetsAt: resetsAt !== null ? iso(resetsAt) : null,
    usedPct,
    source: "provider-headers",
    totals: { ...EMPTY_TOTALS },
  };
}

/**
 * Anthropic subscription ("unified") headers. Assumed shape:
 *   anthropic-ratelimit-unified-5h-utilization: 0.42   (fraction or percent)
 *   anthropic-ratelimit-unified-5h-reset: 1763240000   (epoch s/ms or ISO)
 *   anthropic-ratelimit-unified-7d-utilization / -7d-reset
 *   anthropic-ratelimit-unified-7d_opus-utilization    (model-scoped weekly cap; scope "opus")
 *   anthropic-ratelimit-unified-status: allowed | allowed_warning | rejected
 *   anthropic-ratelimit-unified-reset                  (overall reset)
 */
export function parseAnthropicWindows(h: HeaderBag, nowMs: number): UsageWindow[] {
  const acc = new Map<string, { kind: UsageWindow["kind"]; scope: string | null; pct: number | null; reset: number | null }>();
  const re = /^anthropic-ratelimit-unified-(5h|7d|weekly)(?:[-_]([a-z0-9]+))?-(utilization|used-?pct|reset)$/;
  for (const [k, v] of entries(h)) {
    const m = re.exec(k);
    if (!m) continue;
    const kind: UsageWindow["kind"] = m[1] === "5h" ? "5h" : "weekly";
    const scope = m[2] ?? null;
    const key = `${kind}:${scope ?? ""}`;
    const cur = acc.get(key) ?? { kind, scope, pct: null, reset: null };
    if (m[3] === "reset") cur.reset = parseResetTime(v, nowMs);
    else cur.pct = parsePct(v);
    acc.set(key, cur);
  }
  return [...acc.values()].filter((w) => w.pct !== null || w.reset !== null).map((w) => windowOf(w.kind, w.scope, w.pct, w.reset));
}

/**
 * Codex / ChatGPT subscription headers. Assumed shape:
 *   x-codex-primary-used-percent: 37.5
 *   x-codex-primary-window-minutes: 300
 *   x-codex-primary-reset-after-seconds: 1234   (or -reset-at: epoch/ISO)
 *   x-codex-secondary-* (weekly)
 * Window kind comes from window-minutes when present (300 -> 5h, 10080 -> weekly),
 * else primary = 5h, secondary = weekly.
 */
export function parseCodexWindows(h: HeaderBag, nowMs: number): UsageWindow[] {
  const out: UsageWindow[] = [];
  for (const slot of ["primary", "secondary"] as const) {
    const pct = parsePct(get(h, `x-codex-${slot}-used-percent`));
    const after = get(h, `x-codex-${slot}-reset-after-seconds`);
    const at = get(h, `x-codex-${slot}-reset-at`);
    const reset = after !== undefined && /^\d+(\.\d+)?$/.test(after.trim()) ? nowMs + Number(after) * 1000 : parseResetTime(at, nowMs);
    if (pct === null && reset === null) continue;
    const mins = Number(get(h, `x-codex-${slot}-window-minutes`));
    let kind: UsageWindow["kind"] = slot === "primary" ? "5h" : "weekly";
    if (Number.isFinite(mins) && mins > 0) kind = mins <= 6 * 60 ? "5h" : mins <= 8 * 1440 ? "weekly" : "monthly";
    out.push(windowOf(kind, null, pct, reset));
  }
  return out;
}

export function parseUsageWindows(h: HeaderBag, nowMs: number): UsageWindow[] {
  return [...parseAnthropicWindows(h, nowMs), ...parseCodexWindows(h, nowMs)];
}

/**
 * When should a rate-limited account be retried? Order:
 *  1. Retry-After
 *  2. anthropic-ratelimit-unified-reset (assumed) when status is rejected or present
 *  3. latest documented anthropic-ratelimit-*-reset whose -remaining is 0
 *  4. x-codex-*-reset-* of any window at >= 100 %
 * Returns absolute ms or null (caller falls back to exponential backoff).
 */
export function cooldownHint(h: HeaderBag, nowMs: number): number | null {
  const ra = parseRetryAfter(get(h, "retry-after"), nowMs);
  if (ra !== null) return ra;
  const unified = parseResetTime(get(h, "anthropic-ratelimit-unified-reset"), nowMs);
  if (unified !== null) return unified;
  let best: number | null = null;
  for (const kind of ["requests", "tokens", "input-tokens", "output-tokens"]) {
    const remaining = get(h, `anthropic-ratelimit-${kind}-remaining`);
    if (remaining === undefined || Number(remaining) > 0) continue;
    const r = parseResetTime(get(h, `anthropic-ratelimit-${kind}-reset`), nowMs);
    if (r !== null && (best === null || r > best)) best = r;
  }
  if (best !== null) return best;
  for (const w of parseUsageWindows(h, nowMs)) {
    if ((w.usedPct ?? 0) >= 100 && w.resetsAt) {
      const r = Date.parse(w.resetsAt);
      if (best === null || r > best) best = r;
    }
  }
  return best;
}
