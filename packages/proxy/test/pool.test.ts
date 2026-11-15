import { describe, expect, it } from "vitest";
import { AccountPool, classifyStatus } from "../src/pool.ts";
import { account, baseConfig, FakeClock } from "./helpers.ts";

function pool(accounts: Record<string, unknown>[], routing: Record<string, unknown> = {}) {
  const cfg = baseConfig({ accounts, routing });
  const clock = new FakeClock();
  return { pool: new AccountPool(cfg.accounts, cfg.routing, clock), clock };
}
const pick = (p: AccountPool, extra: Record<string, unknown> = {}) => p.pick({ provider: "anthropic", model: "claude-opus-5-5", ...extra })?.config.id ?? null;

describe("selection", () => {
  it("round-robin rotates within the best priority tier", () => {
    const { pool: p } = pool([account("a"), account("b"), account("c", { priority: 5 })]);
    expect([pick(p), pick(p), pick(p), pick(p)]).toEqual(["a", "b", "a", "b"]);
  });

  it("fill-first sticks to the first account", () => {
    const { pool: p } = pool([account("a"), account("b")], { strategy: "fill-first" });
    expect([pick(p), pick(p), pick(p)]).toEqual(["a", "a", "a"]);
  });

  it("falls to the next priority tier when the best tier is unavailable", () => {
    const { pool: p } = pool([account("a"), account("c", { priority: 5 })]);
    p.reportFailure("a", { kind: "server", status: 503 });
    expect(pick(p)).toBe("c");
  });

  it("standby is used only when no active account is left", () => {
    const { pool: p, clock } = pool([account("act", { priority: 9 }), account("sb", { role: "standby", priority: 0 })]);
    expect(pick(p)).toBe("act"); // even though standby has a better priority number
    p.reportFailure("act", { kind: "rate-limited", status: 429, headers: new Headers({ "retry-after": "10" }) });
    expect(pick(p)).toBe("sb");
    expect(p.stateOf("sb")).toBe("standby");
    clock.advance(10_001);
    expect(pick(p)).toBe("act");
  });

  it("skips disabled accounts and respects model globs and exclude", () => {
    const { pool: p } = pool([account("off", { disabled: true }), account("sonnet-only", { models: ["claude-sonnet-*"] }), account("any")]);
    expect(pick(p)).toBe("any");
    expect(pick(p, { model: "claude-sonnet-5-5", exclude: new Set(["any"]) })).toBe("sonnet-only");
    expect(p.stateOf("off")).toBe("disabled");
    expect(pick(p, { exclude: new Set(["any"]) })).toBeNull();
  });

  it("session affinity keeps a session on the same account and fails over when it is unusable", () => {
    const { pool: p } = pool([account("a"), account("b")], { sessionAffinity: { enabled: true, ttlSec: 60 } });
    const first = pick(p, { sessionKey: "s1" });
    expect([pick(p, { sessionKey: "s1" }), pick(p, { sessionKey: "s1" })]).toEqual([first, first]);
    const other = pick(p, { sessionKey: "s2" });
    expect(other).not.toBe(first);
    p.reportFailure(first!, { kind: "server", status: 500 });
    expect(pick(p, { sessionKey: "s1" })).toBe(other);
  });
});

describe("cooldown", () => {
  it("429 honours retry-after and expires with the clock", () => {
    const { pool: p, clock } = pool([account("a")]);
    p.reportFailure("a", { kind: "rate-limited", status: 429, headers: new Headers({ "retry-after": "30" }) });
    expect(p.stateOf("a")).toBe("cooldown");
    expect(pick(p)).toBeNull();
    clock.advance(29_999);
    expect(pick(p)).toBeNull();
    clock.advance(2);
    expect(pick(p)).toBe("a");
    expect(p.stateOf("a")).toBe("active");
  });

  it("429 honours a reset header when there is no retry-after", () => {
    const { pool: p, clock } = pool([account("a")]);
    const reset = Math.floor(clock.now() / 1000) + 3600;
    p.reportFailure("a", { kind: "rate-limited", status: 429, headers: new Headers({ "anthropic-ratelimit-unified-reset": String(reset) }) });
    expect(p.get("a")!.cooldownUntil).toBe(reset * 1000);
  });

  it("429 without hints: exponential backoff 1s, 2s, 4s … capped at 30 min, reset on success", () => {
    const { pool: p, clock } = pool([account("a")]);
    const seen: number[] = [];
    for (let i = 0; i < 14; i++) {
      p.reportFailure("a", { kind: "rate-limited", status: 429, headers: new Headers() });
      const ms = p.get("a")!.cooldownUntil! - clock.now();
      seen.push(ms);
      clock.advance(ms);
    }
    expect(seen.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(Math.max(...seen)).toBe(30 * 60_000);
    expect(seen[seen.length - 1]).toBe(30 * 60_000);
    p.reportSuccess("a");
    p.reportFailure("a", { kind: "rate-limited", status: 429 });
    expect(p.get("a")!.cooldownUntil! - clock.now()).toBe(1000);
  });

  it("401/403 -> sticky error until resetError()", () => {
    const { pool: p, clock } = pool([account("a")]);
    p.reportFailure("a", { kind: "auth", status: 401 });
    expect(p.stateOf("a")).toBe("error");
    clock.advance(365 * 86400_000);
    expect(pick(p)).toBeNull();
    p.resetError("a");
    expect(pick(p)).toBe("a");
  });

  it("5xx / timeout -> 60 s cooldown", () => {
    const { pool: p, clock } = pool([account("a")]);
    p.reportFailure("a", { kind: "timeout" });
    expect(p.get("a")!.cooldownUntil! - clock.now()).toBe(60_000);
    clock.advance(60_000);
    expect(pick(p)).toBe("a");
  });

  it("404 -> cooldown only for that model", () => {
    const { pool: p, clock } = pool([account("a")]);
    p.reportFailure("a", { kind: "model-not-found", status: 404, model: "claude-opus-5-5" });
    expect(pick(p)).toBeNull();
    expect(pick(p, { model: "claude-sonnet-5-5" })).toBe("a");
    expect(p.stateOf("a")).toBe("active");
    clock.advance(12 * 3600_000);
    expect(pick(p)).toBe("a");
  });

  it("nextAvailableAt reports the earliest cooldown end", () => {
    const { pool: p, clock } = pool([account("a"), account("b")]);
    p.reportFailure("a", { kind: "rate-limited", headers: new Headers({ "retry-after": "50" }) });
    p.reportFailure("b", { kind: "rate-limited", headers: new Headers({ "retry-after": "20" }) });
    expect(p.nextAvailableAt({ provider: "anthropic", model: "claude-opus-5-5" })).toBe(clock.now() + 20_000);
  });
});

describe("classifyStatus", () => {
  it("maps statuses to failure kinds", () => {
    expect(classifyStatus(429)).toBe("rate-limited");
    expect(classifyStatus(401)).toBe("auth");
    expect(classifyStatus(403)).toBe("auth");
    expect(classifyStatus(404)).toBe("model-not-found");
    expect(classifyStatus(529)).toBe("server");
    expect(classifyStatus(408)).toBe("server");
    expect(classifyStatus(400)).toBeNull();
    expect(classifyStatus(422)).toBeNull();
  });
});
