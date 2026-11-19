/**
 * Account pool per provider.
 *
 * Selection (pick):
 *   1. candidates = accounts of the provider (or the route's account list), serving the model
 *   2. drop disabled / error / in cooldown / model-cooldown / already tried in this request
 *   3. if any "active" candidate remains, use only actives; else standby ("standby only when no active left")
 *   4. keep only the lowest priority number tier
 *   5. session affinity: reuse the bound account if it is in that set
 *   6. strategy: round-robin (rotating per provider+tier) or fill-first (first in config order)
 *
 * Outcome reporting (reportSuccess / reportFailure) drives state:
 *   429          -> cooldown until Retry-After / reset header, else exp backoff base..max (1 s..30 min)
 *   401 / 403    -> error (needs re-login; manual reset)
 *   5xx / timeout / network -> cooldown serverErrorMs (60 s)
 *   404          -> per-model cooldown (modelNotFoundMs)
 */
import type { PoolState, UsageWindow } from "@fhub/core";
import type { AccountConfig, ProxyConfig } from "./config.ts";
import { cooldownHint, parseUsageWindows } from "./ratelimit.ts";
import { type Clock, anyGlob } from "./util.ts";

export interface AccountRuntime {
  config: AccountConfig;
  /** Sticky error (401/403) — cleared only by resetError(). */
  error: string | null;
  cooldownUntil: number | null;
  backoffLevel: number;
  modelCooldowns: Map<string, number>;
  lastUsedAt: number | null;
  lastError: string | null;
  windows: UsageWindow[];
  windowsAt: number | null;
}

export type FailureKind = "rate-limited" | "auth" | "server" | "timeout" | "network" | "model-not-found";

export interface FailureInfo {
  kind: FailureKind;
  status?: number;
  headers?: Headers;
  model?: string;
  message?: string;
}

export interface PickOptions {
  provider: string;
  model: string;
  /** Restrict to these account ids (route accounts), in pool order. Empty/undefined = all of provider. */
  accountIds?: readonly string[];
  exclude?: ReadonlySet<string>;
  sessionKey?: string | null;
}

export function classifyStatus(status: number): FailureKind | null {
  if (status === 429) return "rate-limited";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "model-not-found";
  if (status === 408 || status >= 500) return "server";
  return null; // other 4xx: the client's fault, no failover
}

export class AccountPool {
  readonly accounts = new Map<string, AccountRuntime>();
  private rr = new Map<string, number>();
  private affinity = new Map<string, { accountId: string; expiresAt: number }>();
  private readonly routing: ProxyConfig["routing"];
  private readonly clock: Clock;

  constructor(accounts: AccountConfig[], routing: ProxyConfig["routing"], clock: Clock) {
    this.routing = routing;
    this.clock = clock;
    for (const a of accounts) {
      this.accounts.set(a.id, {
        config: a,
        error: null,
        cooldownUntil: null,
        backoffLevel: 0,
        modelCooldowns: new Map(),
        lastUsedAt: null,
        lastError: null,
        windows: [],
        windowsAt: null,
      });
    }
  }

  get(id: string): AccountRuntime | undefined {
    return this.accounts.get(id);
  }

  stateOf(id: string): PoolState {
    const a = this.accounts.get(id);
    if (!a) return "error";
    if (a.config.disabled) return "disabled";
    if (a.error) return "error";
    if (a.cooldownUntil !== null && a.cooldownUntil > this.clock.now()) return "cooldown";
    return a.config.role;
  }

  private eligible(a: AccountRuntime, model: string, now: number): boolean {
    if (a.config.disabled || a.error) return false;
    if (a.cooldownUntil !== null) {
      if (a.cooldownUntil > now) return false;
      a.cooldownUntil = null; // expired
    }
    const mc = a.modelCooldowns.get(model);
    if (mc !== undefined) {
      if (mc > now) return false;
      a.modelCooldowns.delete(model);
    }
    return anyGlob(a.config.models, model);
  }

  /** Candidates for this provider/model in config order (no state filtering). */
  candidates(opts: Pick<PickOptions, "provider" | "model" | "accountIds">): AccountRuntime[] {
    const ids = opts.accountIds && opts.accountIds.length > 0 ? opts.accountIds : [...this.accounts.keys()];
    return ids.map((id) => this.accounts.get(id)).filter((a): a is AccountRuntime => !!a && a.config.provider === opts.provider && anyGlob(a.config.models, opts.model));
  }

  pick(opts: PickOptions): AccountRuntime | null {
    const now = this.clock.now();
    this.gcAffinity(now);
    const usable = this.candidates(opts).filter((a) => !opts.exclude?.has(a.config.id) && this.eligible(a, opts.model, now));
    if (usable.length === 0) return null;
    const actives = usable.filter((a) => a.config.role === "active");
    const pool = actives.length > 0 ? actives : usable; // standby only when no active left
    const minPrio = Math.min(...pool.map((a) => a.config.priority));
    const tier = pool.filter((a) => a.config.priority === minPrio);

    const aff = this.routing.sessionAffinity;
    if (aff.enabled && opts.sessionKey) {
      const bound = this.affinity.get(opts.sessionKey);
      // keep a bound account even if it is not in the best tier, as long as it is usable:
      // rotating would invalidate the upstream prompt cache.
      const hit = bound && pool.find((a) => a.config.id === bound.accountId);
      if (hit) {
        bound.expiresAt = now + aff.ttlSec * 1000;
        return hit;
      }
    }

    let chosen: AccountRuntime;
    if (this.routing.strategy === "fill-first") chosen = tier[0]!;
    else {
      const key = `${opts.provider}|${minPrio}|${actives.length > 0 ? "a" : "s"}`;
      const n = this.rr.get(key) ?? 0;
      chosen = tier[n % tier.length]!;
      this.rr.set(key, n + 1);
    }
    if (aff.enabled && opts.sessionKey) this.affinity.set(opts.sessionKey, { accountId: chosen.config.id, expiresAt: now + aff.ttlSec * 1000 });
    return chosen;
  }

  private gcAffinity(now: number) {
    for (const [k, v] of this.affinity) if (v.expiresAt <= now) this.affinity.delete(k);
  }

  /** Record rate-limit windows from any upstream response (success or not). */
  observeHeaders(id: string, headers: Headers) {
    const a = this.accounts.get(id);
    if (!a) return;
    const now = this.clock.now();
    const w = parseUsageWindows(headers, now);
    if (w.length > 0) {
      a.windows = w;
      a.windowsAt = now;
    }
  }

  reportSuccess(id: string) {
    const a = this.accounts.get(id);
    if (!a) return;
    a.backoffLevel = 0;
    a.lastUsedAt = this.clock.now();
  }

  reportFailure(id: string, f: FailureInfo) {
    const a = this.accounts.get(id);
    if (!a) return;
    const now = this.clock.now();
    const cd = this.routing.cooldown;
    a.lastUsedAt = now;
    a.lastError = `${f.kind}${f.status ? ` ${f.status}` : ""}${f.message ? `: ${f.message.slice(0, 200)}` : ""}`;
    switch (f.kind) {
      case "rate-limited": {
        const hint = f.headers ? cooldownHint(f.headers, now) : null;
        if (hint !== null && hint > now) {
          a.cooldownUntil = Math.min(hint, now + Math.max(cd.backoffMaxMs, 7 * 86400_000));
        } else {
          const ms = Math.min(cd.backoffMaxMs, cd.backoffBaseMs * 2 ** a.backoffLevel);
          a.cooldownUntil = now + ms;
        }
        a.backoffLevel++;
        break;
      }
      case "auth":
        a.error = a.lastError;
        break;
      case "server":
      case "timeout":
      case "network":
        a.cooldownUntil = now + cd.serverErrorMs;
        break;
      case "model-not-found":
        if (f.model) a.modelCooldowns.set(f.model, now + cd.modelNotFoundMs);
        break;
    }
  }

  /** Manual action (phase 2 UI / CLI): clear a sticky auth error after re-login. */
  resetError(id: string) {
    const a = this.accounts.get(id);
    if (a) {
      a.error = null;
      a.lastError = null;
    }
  }

  /** Earliest moment any candidate becomes usable again (for Retry-After to the client). */
  nextAvailableAt(opts: Pick<PickOptions, "provider" | "model" | "accountIds">): number | null {
    let best: number | null = null;
    for (const a of this.candidates(opts)) {
      if (a.config.disabled || a.error) continue;
      const t = Math.max(a.cooldownUntil ?? 0, a.modelCooldowns.get(opts.model) ?? 0);
      if (best === null || t < best) best = t;
    }
    return best;
  }
}
