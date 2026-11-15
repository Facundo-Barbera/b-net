/**
 * All header fixtures here are SYNTHETIC. The unified-* and x-codex-* formats are
 * assumptions (undocumented); see src/ratelimit.ts and docs/notes/proxy.md.
 */
import { UsageWindow } from "@bixku/core";
import { describe, expect, it } from "vitest";
import { cooldownHint, parseAnthropicWindows, parseCodexWindows, parsePct, parseResetTime, parseRetryAfter } from "../src/ratelimit.ts";
import { T0 } from "./helpers.ts";

const S = (ms: number) => Math.floor(ms / 1000);

describe("primitive parsers", () => {
  it("percent: fraction vs percent", () => {
    expect(parsePct("0.42")).toBe(42);
    expect(parsePct("42")).toBe(42);
    expect(parsePct("42.5%")).toBe(42.5);
    expect(parsePct("1.0")).toBe(100);
    expect(parsePct("250")).toBe(100);
    expect(parsePct("nope")).toBeNull();
    expect(parsePct("-3")).toBeNull();
  });
  it("reset: epoch s, epoch ms, ISO, relative seconds", () => {
    expect(parseResetTime(String(S(T0) + 60), T0)).toBe(T0 + 60_000);
    expect(parseResetTime(String(T0 + 5), T0)).toBe(T0 + 5);
    expect(parseResetTime("2026-11-15T13:00:00Z", T0)).toBe(T0 + 3600_000);
    expect(parseResetTime("30", T0)).toBe(T0 + 30_000);
    expect(parseResetTime("garbage", T0)).toBeNull();
  });
  it("retry-after: seconds or HTTP date", () => {
    expect(parseRetryAfter("12", T0)).toBe(T0 + 12_000);
    expect(parseRetryAfter(new Date(T0 + 90_000).toUTCString(), T0)).toBe(T0 + 90_000);
  });
});

describe("Anthropic unified windows (synthetic, assumed format)", () => {
  const h = new Headers({
    "anthropic-ratelimit-unified-status": "allowed",
    "anthropic-ratelimit-unified-5h-utilization": "0.37",
    "anthropic-ratelimit-unified-5h-reset": String(S(T0) + 2 * 3600),
    "anthropic-ratelimit-unified-7d-utilization": "0.81",
    "anthropic-ratelimit-unified-7d-reset": String(S(T0) + 3 * 86400),
    "anthropic-ratelimit-unified-7d_opus-utilization": "0.95",
  });
  it("parses 5h, weekly and a model-scoped weekly window", () => {
    const ws = parseAnthropicWindows(h, T0);
    expect(ws).toHaveLength(3);
    for (const w of ws) expect(UsageWindow.safeParse(w).success).toBe(true);
    const five = ws.find((w) => w.kind === "5h")!;
    expect(five.usedPct).toBe(37);
    expect(five.resetsAt).toBe(new Date(T0 + 2 * 3600_000).toISOString());
    expect(five.startedAt).toBe(new Date(T0 - 3 * 3600_000).toISOString());
    expect(five.source).toBe("provider-headers");
    expect(ws.find((w) => w.kind === "weekly" && w.scope === null)!.usedPct).toBe(81);
    expect(ws.find((w) => w.scope === "opus")!.usedPct).toBe(95);
  });
  it("ignores unrelated and documented per-minute headers", () => {
    expect(parseAnthropicWindows(new Headers({ "anthropic-ratelimit-requests-remaining": "5" }), T0)).toEqual([]);
  });
});

describe("Codex windows (synthetic, assumed format)", () => {
  it("maps primary/secondary by window-minutes", () => {
    const ws = parseCodexWindows(
      new Headers({
        "x-codex-primary-used-percent": "12.5",
        "x-codex-primary-window-minutes": "300",
        "x-codex-primary-reset-after-seconds": "600",
        "x-codex-secondary-used-percent": "64",
        "x-codex-secondary-window-minutes": "10080",
        "x-codex-secondary-reset-at": String(S(T0) + 86400),
      }),
      T0,
    );
    expect(ws.map((w) => [w.kind, w.usedPct])).toEqual([
      ["5h", 12.5],
      ["weekly", 64],
    ]);
    expect(ws[0]!.resetsAt).toBe(new Date(T0 + 600_000).toISOString());
  });
  it("defaults primary=5h, secondary=weekly without window-minutes", () => {
    const ws = parseCodexWindows(new Headers({ "x-codex-secondary-used-percent": "5" }), T0);
    expect(ws[0]!.kind).toBe("weekly");
  });
});

describe("cooldownHint", () => {
  it("prefers retry-after", () => {
    expect(cooldownHint(new Headers({ "retry-after": "7", "anthropic-ratelimit-unified-reset": String(S(T0) + 999) }), T0)).toBe(T0 + 7000);
  });
  it("uses unified reset", () => {
    expect(cooldownHint(new Headers({ "anthropic-ratelimit-unified-reset": String(S(T0) + 120) }), T0)).toBe(T0 + 120_000);
  });
  it("uses documented per-minute reset when remaining is 0", () => {
    const h = new Headers({
      "anthropic-ratelimit-tokens-remaining": "0",
      "anthropic-ratelimit-tokens-reset": "2026-11-15T12:00:42Z",
      "anthropic-ratelimit-requests-remaining": "10",
      "anthropic-ratelimit-requests-reset": "2026-11-15T12:30:00Z",
    });
    expect(cooldownHint(h, T0)).toBe(T0 + 42_000);
  });
  it("uses a codex window at 100%", () => {
    expect(cooldownHint(new Headers({ "x-codex-primary-used-percent": "100", "x-codex-primary-reset-after-seconds": "90" }), T0)).toBe(T0 + 90_000);
  });
  it("null when nothing usable", () => {
    expect(cooldownHint(new Headers({}), T0)).toBeNull();
  });
});
