import { describe, expect, it } from "vitest";
import { computeCost, findPrice, normalizeModel, PRICING_TABLE } from "../src/pricing.ts";

const t = (inputTokens: number, outputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0) => ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

describe("pricing table", () => {
  it("is versioned and cites its sources with a date", () => {
    expect(PRICING_TABLE.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    const anth = PRICING_TABLE.sources.find((s) => s.provider === "anthropic")!;
    expect(anth.retrievedAt).toBe("2026-11-03");
  });

  it("has the given Anthropic list prices", () => {
    const p = (m: string) => findPrice(m)!.tiers[0]!;
    expect(p("claude-fable-5-2")).toMatchObject({ input: 8, output: 40, cacheRead: 0.2 });
    expect(p("claude-opus-5-5")).toMatchObject({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
    expect(p("claude-opus-5")).toMatchObject({ input: 5, output: 25 });
    expect(p("claude-opus-4-8")).toMatchObject({ input: 5, output: 25 });
    expect(p("claude-sonnet-5-5")).toMatchObject({ input: 2, output: 10, cacheRead: 0.1 });
    expect(p("claude-sonnet-5")).toMatchObject({ input: 2, output: 10 });
    expect(p("claude-sonnet-4-6")).toMatchObject({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
    expect(p("claude-haiku-4-5")).toMatchObject({ input: 1, output: 5 });
  });

  it("flags derived cache prices as assumed", () => {
    expect(findPrice("claude-opus-5-5")!.assumed).toEqual({ cacheRead: false, cacheWrite: true });
    expect(findPrice("claude-opus-5")!.assumed).toEqual({ cacheRead: true, cacheWrite: true });
  });

  it("OpenAI entries are unverified placeholders with no numbers", () => {
    const e = findPrice("gpt-5")!;
    expect(e.verified).toBe(false);
    expect(e.tiers[0]!.input).toBeNull();
    expect(computeCost("gpt-5", t(1000, 1000)).costUsd).toBeNull();
  });

  it("normalizes date / reasoning / context suffixes and matches by segment prefix", () => {
    expect(normalizeModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normalizeModel("claude-opus-5-5[1m]")).toBe("claude-opus-5-5");
    expect(normalizeModel("claude-opus-5-5(high)")).toBe("claude-opus-5-5");
    expect(findPrice("claude-opus-5-5-20261001")!.model).toBe("claude-opus-5-5");
    expect(findPrice("claude-opus-5")!.model).toBe("claude-opus-5");
    expect(findPrice("claude-opus-50")).toBeNull();
    expect(findPrice("totally-unknown")).toBeNull();
  });
});

describe("computeCost", () => {
  it("opus 5.5 with cache read + (assumed) cache write", () => {
    const r = computeCost("claude-opus-5-5", t(1200, 420, 5000, 300));
    // 1200*4 + 420*20 + 5000*0.2 + 300*5 = 15700 µ$
    expect(r.costUsd).toBeCloseTo(0.0157, 9);
    expect(r.assumed).toBe(true);
  });

  it("sonnet 5.5 cache read uses the given $0.10 and is not assumed", () => {
    const r = computeCost("claude-sonnet-5-5", t(100, 50, 1000));
    expect(r.costUsd).toBeCloseTo(0.0008, 9);
    expect(r.assumed).toBe(false);
  });

  it("haiku 5.5 switches tier above 100K prompt tokens", () => {
    expect(computeCost("claude-haiku-5-5", t(50_000, 1000)).costUsd).toBeCloseTo(0.0055, 9);
    expect(computeCost("claude-haiku-5-5", t(100_000, 0)).costUsd).toBeCloseTo(0.01, 9);
    const big = computeCost("claude-haiku-5-5", t(150_000, 1000));
    expect(big.costUsd).toBeCloseTo(0.0775, 9);
    expect(big.tier!.maxPromptTokens).toBeNull();
    // cache tokens count towards the prompt size
    expect(computeCost("claude-haiku-5-5", t(60_000, 0, 50_000)).tier!.input).toBe(0.5);
  });

  it("unknown model -> null cost", () => {
    expect(computeCost("mystery-model", t(1, 1)).costUsd).toBeNull();
  });
});
