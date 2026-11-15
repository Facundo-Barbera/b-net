import { describe, expect, it } from "vitest";
import {
  DASH,
  formatAbsolute,
  formatBps,
  formatBytes,
  formatDuration,
  formatMs,
  formatPercent,
  formatRelative,
  formatTokens,
  formatUsd,
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
    expect(formatMs(820)).toBe("820ms");
    expect(formatMs(6400)).toBe("6.4s");
    expect(formatMs(41_200)).toBe("41s");
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
