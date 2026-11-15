import { describe, expect, it } from "vitest";
import * as T from "../src/lib/thresholds.ts";
import { meterTone } from "../src/components/index.ts";
import {
  DASH,
  formatAbsolute,
  formatBps,
  formatBytes,
  formatCountdown,
  formatDuration,
  formatInt,
  formatMoney,
  formatMs,
  formatPercent,
  formatRelative,
  formatRelativeSpan,
  formatSpan,
  formatTokens,
  formatUsd,
  formatUsdHeadline,
  formatUsedOfGb,
} from "../src/lib/format.ts";

describe("formatters", () => {
  it("returns a dash for missing values", () => {
    for (const f of [formatBytes, formatBps, formatPercent, formatTokens, formatUsd, formatDuration, formatMs]) {
      expect(f(null)).toBe(DASH);
      expect(f(undefined)).toBe(DASH);
      expect(f(Number.NaN)).toBe(DASH);
    }
    expect(formatRelative(null)).toBe(DASH);
    expect(formatRelative("not a date")).toBe(DASH);
    expect(formatAbsolute(undefined)).toBe(DASH);
  });

  it("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(123 * 1024 ** 2)).toBe("123 MB");
    expect(formatBytes(12.9 * 1024 ** 3)).toBe("12.9 GB");
    expect(formatBytes(2 * 1024 ** 4)).toBe("2 TB");
  });

  it("formatBps takes bytes per second", () => {
    expect(formatBps(0)).toBe("0 B/s");
    expect(formatBps(182_000)).toBe("178 KB/s");
    expect(formatBps(3_400_000)).toBe("3.24 MB/s");
  });

  it("formatPercent", () => {
    expect(formatPercent(63.6)).toBe("64%");
    expect(formatPercent(12.34, 1)).toBe("12.3%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("formatTokens", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(12_345)).toBe("12.3k");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(301_000_000)).toBe("301M");
    expect(formatTokens(2_610_000_000)).toBe("2.61B");
    expect(formatTokens(999_999)).toBe("1M");
  });

  it("formatUsd", () => {
    expect(formatUsd(1066.5)).toBe("$1,066.50");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(-3.5)).toBe("-$3.50");
    expect(formatUsd(1_234_567.891)).toBe("$1,234,567.89");
    expect(formatUsd(41.256, 0)).toBe("$41");
  });

  it("formatDuration keeps the two largest units", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(312)).toBe("5m 12s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(11_520)).toBe("3h 12m");
    expect(formatDuration(100_800)).toBe("1d 4h");
    expect(formatDuration(1_904_400)).toBe("22d 1h");
  });

  it("formatMs", () => {
    expect(formatMs(820)).toBe("820 ms");
    expect(formatMs(6400)).toBe("6.4 s");
    expect(formatMs(41_200)).toBe("41 s");
    expect(formatMs(125_000)).toBe("2m 5s");
  });

  it("formatRelative uses the injected now", () => {
    const now = Date.parse("2026-11-15T20:30:00.000Z");
    const at = (deltaSec: number) => new Date(now + deltaSec * 1000).toISOString();
    expect(formatRelative(at(-3), now)).toBe("just now");
    expect(formatRelative(at(2), now)).toBe("just now");
    expect(formatRelative(at(-12), now)).toBe("12s ago");
    expect(formatRelative(at(-5 * 60), now)).toBe("5m ago");
    expect(formatRelative(at(-3 * 3600), now)).toBe("3h ago");
    expect(formatRelative(at(-26 * 3600), now)).toBe("1d ago");
    expect(formatRelative(at(-45 * 86_400), now)).toBe("1mo ago");
    expect(formatRelative(at(38 * 60), now)).toBe("in 38m");
    expect(formatRelative(new Date(now - 60_000), new Date(now))).toBe("1m ago");
    expect(formatRelative(now - 60_000, now)).toBe("1m ago");
  });

  it("formatAbsolute is a deterministic UTC string", () => {
    expect(formatAbsolute("2026-11-15T20:30:00.000Z")).toBe("2026-11-15 20:30 UTC");
  });
});

describe("precise spans and countdowns", () => {
  const now = Date.parse("2026-11-15T20:30:00.000Z");
  const at = (sec: number) => new Date(now + sec * 1000).toISOString();

  it("formatSpan keeps zero parts and ignores the sign", () => {
    expect(formatSpan(130 * 60_000)).toBe("2h 10m");
    expect(formatSpan(7 * 3_600_000)).toBe("7h 0m");
    expect(formatSpan((20 * 1440) * 60_000)).toBe("20d 0h");
    expect(formatSpan(-38 * 60_000)).toBe("38m");
    expect(formatSpan(20_000)).toBe("<1m");
    expect(formatSpan(20_000, { seconds: true })).toBe("20s");
  });

  it("formatCountdown is null when unknown or past", () => {
    expect(formatCountdown(at(38 * 60), now)).toBe("38m");
    expect(formatCountdown(at(-1), now)).toBeNull();
    expect(formatCountdown(at(0), now)).toBeNull();
    expect(formatCountdown(null, now)).toBeNull();
    expect(formatCountdown("nope", now)).toBeNull();
  });

  it("formatRelativeSpan is signed and localizable", () => {
    expect(formatRelativeSpan(at(130 * 60), now)).toBe("in 2h 10m");
    expect(formatRelativeSpan(at(-22 * 60), now)).toBe("22m ago");
    expect(formatRelativeSpan(at(130 * 60), now, { lang: "es" })).toBe("en 2h 10m");
    expect(formatRelativeSpan(at(-22 * 60), now, { lang: "es" })).toBe("hace 22m");
    expect(formatRelativeSpan(at(-12), now, { lang: "es", seconds: true })).toBe("hace 12s");
    expect(formatRelativeSpan(at(-12), now, { lang: "es" })).toBe("hace <1m");
    expect(formatRelativeSpan(null, now)).toBe(DASH);
  });
});

describe("number and money helpers", () => {
  it("formatInt groups thousands", () => {
    expect(formatInt(1234567)).toBe("1,234,567");
    expect(formatInt(0)).toBe("0");
    expect(formatInt(null)).toBe(DASH);
  });

  it("formatUsdHeadline drops cents for whole or large amounts", () => {
    expect(formatUsdHeadline(3980.2)).toBe("$3,980");
    expect(formatUsdHeadline(200)).toBe("$200");
    expect(formatUsdHeadline(41.26)).toBe("$41.26");
    expect(formatUsdHeadline(undefined)).toBe(DASH);
  });

  it("formatMoney handles USD and other currencies", () => {
    expect(formatMoney(41.256, "USD")).toBe("$41.26");
    expect(formatMoney(12.5, "EUR")).toBe("12.50 EUR");
    expect(formatMoney(null, "USD")).toBe(DASH);
  });

  it("formatUsedOfGb switches to TB from 1000 GB", () => {
    expect(formatUsedOfGb(5.3, 7.5)).toBe("5.3 / 7.5 GB");
    expect(formatUsedOfGb(120, 480)).toBe("120 / 480 GB");
    expect(formatUsedOfGb(1846, 2000)).toBe("1.8 / 2.0 TB");
    expect(formatUsedOfGb(Number.NaN, 10)).toBe(DASH);
  });
});

describe("thresholds", () => {
  it("is the single source for meter tones", () => {
    expect(T.USAGE_WARN_AT).toBeLessThan(T.USAGE_DANGER_AT);
    expect(meterTone(T.USAGE_WARN_AT - 0.1)).toBe("ok");
    expect(meterTone(T.USAGE_WARN_AT)).toBe("warn");
    expect(meterTone(T.USAGE_DANGER_AT - 0.1)).toBe("warn");
    expect(meterTone(T.USAGE_DANGER_AT)).toBe("danger");
    expect(T.TEMP_WARN_C).toBeLessThan(T.TEMP_DANGER_C);
  });
});
