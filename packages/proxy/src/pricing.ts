/**
 * Versioned list-price table + cost calculation.
 *
 * Costs are ALWAYS at public list price (USD per million tokens), regardless of
 * what a subscription actually bills. Bump `PRICING_TABLE.version` on any change.
 *
 * Flags:
 *  - `assumed.cacheRead` / `assumed.cacheWrite`: the price was not given by the
 *    source, so it is derived (cache read = 0.1x input, cache write = 1.25x input,
 *    i.e. the 5-minute cache-write multiplier).
 *  - `verified: false`: placeholder entry. Prices are null -> cost is null.
 *    Do not invent numbers; fill these from the provider's pricing page.
 */
import type { ProviderId } from "@fhub/core";

export interface PriceTier {
  /** Applies while promptTokens (input + cache read + cache write) <= this. null = no upper bound. */
  maxPromptTokens: number | null;
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
}

export interface PriceEntry {
  model: string;
  provider: ProviderId;
  tiers: PriceTier[];
  assumed: { cacheRead: boolean; cacheWrite: boolean };
  verified: boolean;
  note?: string;
}

export interface PricingTable {
  version: string;
  currency: "USD";
  unit: "per-million-tokens";
  sources: Array<{ provider: ProviderId; source: string; retrievedAt: string }>;
  entries: PriceEntry[];
}

const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_MULT = 1.25;

function anthropic(model: string, input: number, output: number, cacheRead?: number, extraTiers: Array<{ above: number; input: number; output: number }> = []): PriceEntry {
  const mk = (maxPromptTokens: number | null, i: number, o: number, cr?: number): PriceTier => ({
    maxPromptTokens,
    input: i,
    output: o,
    cacheRead: round(cr ?? i * CACHE_READ_MULT),
    cacheWrite: round(i * CACHE_WRITE_MULT),
  });
  const tiers: PriceTier[] = [];
  if (extraTiers.length === 0) tiers.push(mk(null, input, output, cacheRead));
  else {
    tiers.push(mk(extraTiers[0]!.above, input, output, cacheRead));
    extraTiers.forEach((t, idx) => tiers.push(mk(extraTiers[idx + 1]?.above ?? null, t.input, t.output)));
  }
  return { model, provider: "anthropic", tiers, assumed: { cacheRead: cacheRead === undefined, cacheWrite: true }, verified: true };
}

function placeholder(model: string, provider: ProviderId): PriceEntry {
  return {
    model,
    provider,
    tiers: [{ maxPromptTokens: null, input: null, output: null, cacheRead: null, cacheWrite: null }],
    assumed: { cacheRead: true, cacheWrite: true },
    verified: false,
    note: "PLACEHOLDER: price not verified. Fill from the provider pricing page before trusting costs.",
  };
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export const PRICING_TABLE: PricingTable = {
  version: "2026-11-15.1",
  currency: "USD",
  unit: "per-million-tokens",
  sources: [
    { provider: "anthropic", source: "Anthropic pricing docs (cached copy)", retrievedAt: "2026-11-03" },
    { provider: "openai", source: "none: placeholders, not verified", retrievedAt: "2026-11-15" },
  ],
  entries: [
    anthropic("claude-fable-5-2", 8, 40, 0.2),
    anthropic("claude-opus-5-5", 4, 20, 0.2),
    anthropic("claude-opus-5", 5, 25),
    anthropic("claude-opus-4-8", 5, 25),
    anthropic("claude-sonnet-5-5", 2, 10, 0.1),
    anthropic("claude-sonnet-5", 2, 10),
    anthropic("claude-sonnet-4-6", 3, 15),
    // Haiku 5.5: $0.10/$0.50 up to 100K prompt tokens, $0.50/$2.50 beyond.
    anthropic("claude-haiku-5-5", 0.1, 0.5, undefined, [{ above: 100_000, input: 0.5, output: 2.5 }]),
    anthropic("claude-haiku-4-5", 1, 5),
    placeholder("gpt-5", "openai"),
    placeholder("gpt-5-mini", "openai"),
    placeholder("gpt-5-codex", "openai"),
  ],
};

/** Strip decorations a client may add: date suffix, reasoning suffix "(high)", context tag "[1m]". */
export function normalizeModel(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[[^\]]*\]$/, "")
    .replace(/\([^)]*\)$/, "")
    .replace(/[-@]\d{8}$/, "");
}

export function findPrice(model: string, table: PricingTable = PRICING_TABLE): PriceEntry | null {
  const m = normalizeModel(model);
  const exact = table.entries.find((e) => e.model === m);
  if (exact) return exact;
  // longest prefix that ends at a segment boundary, e.g. "claude-opus-4-8-latest" -> "claude-opus-4-8"
  let best: PriceEntry | null = null;
  for (const e of table.entries) {
    if (m.startsWith(e.model) && /[-@.]/.test(m[e.model.length] ?? "") && (!best || e.model.length > best.model.length)) best = e;
  }
  return best;
}

export interface TokenCounts {
  inputTokens: number; // non-cached input
  outputTokens: number; // includes reasoning tokens
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface CostResult {
  costUsd: number | null;
  entry: PriceEntry | null;
  tier: PriceTier | null;
  assumed: boolean;
}

export function computeCost(model: string, t: TokenCounts, table: PricingTable = PRICING_TABLE): CostResult {
  const entry = findPrice(model, table);
  if (!entry) return { costUsd: null, entry: null, tier: null, assumed: false };
  if (!entry.verified) return { costUsd: null, entry, tier: null, assumed: true };
  const prompt = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
  const tier = entry.tiers.find((x) => x.maxPromptTokens === null || prompt <= x.maxPromptTokens) ?? entry.tiers[entry.tiers.length - 1]!;
  const parts: Array<[number, number | null]> = [
    [t.inputTokens, tier.input],
    [t.outputTokens, tier.output],
    [t.cacheReadTokens, tier.cacheRead],
    [t.cacheWriteTokens, tier.cacheWrite],
  ];
  let usd = 0;
  for (const [n, price] of parts) {
    if (n === 0) continue;
    if (price === null) return { costUsd: null, entry, tier, assumed: true };
    usd += (n * price) / 1_000_000;
  }
  const assumed = (t.cacheReadTokens > 0 && entry.assumed.cacheRead) || (t.cacheWriteTokens > 0 && entry.assumed.cacheWrite);
  return { costUsd: round(usd), entry, tier, assumed };
}
