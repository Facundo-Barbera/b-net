/**
 * Display formatters shared by every view. All of them are pure and locale-independent
 * (deterministic output in tests) and return DASH ("—") for null / undefined / NaN input.
 */

export const DASH = "—";

type Maybe = number | null | undefined;
const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** ~3 significant digits without trailing zeros: 1.5, 12.3, 123. */
function sig3(v: number): string {
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return String(Number(v.toFixed(d)));
}

/** Scale `n` down through `units` (each step = `base`) and format with sig3. */
function scale(n: number, units: readonly string[], base: number): string {
  let v = n;
  let i = 0;
  while (Math.abs(v) >= base && i < units.length - 1) {
    v /= base;
    i++;
  }
  let s = sig3(v);
  if (Math.abs(Number(s)) >= base && i < units.length - 1) {
    v /= base;
    i++;
    s = sig3(v);
  }
  return `${s}${units[i]}`;
}

/** Bytes → "512 B", "1.5 KB", "12.3 GB" (base 1024). */
export function formatBytes(bytes: Maybe): string {
  if (!isNum(bytes)) return DASH;
  if (Math.abs(bytes) < 1024) return `${Math.round(bytes)} B`;
  return scale(bytes, [" B", " KB", " MB", " GB", " TB", " PB"], 1024);
}

/** Network rate given in BYTES per second → "178 KB/s" (the `netRxBps`/`netTxBps` contract fields). */
export function formatBps(bytesPerSec: Maybe): string {
  if (!isNum(bytesPerSec)) return DASH;
  if (Math.abs(bytesPerSec) < 1024) return `${Math.round(bytesPerSec)} B/s`;
  return scale(bytesPerSec, [" B/s", " KB/s", " MB/s", " GB/s", " TB/s"], 1024);
}

/** A 0–100 value → "64%". `decimals` defaults to 0. */
export function formatPercent(value: Maybe, decimals = 0): string {
  return isNum(value) ? `${value.toFixed(decimals)}%` : DASH;
}

/** Token counts → "950", "12.3k", "1.2M", "2.61B". */
export function formatTokens(n: Maybe): string {
  if (!isNum(n)) return DASH;
  if (Math.abs(n) < 1000) return String(Math.round(n));
  return scale(n, ["", "k", "M", "B", "T"], 1000);
}

/** USD with thousands separators: "$1,066.50". Sub-cent amounts auto-switch to 4 decimals. */
export function formatUsd(n: Maybe, decimals?: number): string {
  if (!isNum(n)) return DASH;
  const a = Math.abs(n);
  const d = decimals ?? (a > 0 && a < 0.01 ? 4 : 2);
  const [int, frac] = a.toFixed(d).split(".") as [string, string | undefined];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = n < 0 && Number(a.toFixed(d)) !== 0 ? "-" : "";
  return `${sign}$${grouped}${frac ? `.${frac}` : ""}`;
}

/** Seconds → two largest units: "45s", "5m 12s", "3h 12m", "1d 4h". */
export function formatDuration(seconds: Maybe): string {
  if (!isNum(seconds)) return DASH;
  const total = Math.max(0, Math.round(seconds));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** Milliseconds (latency) → "820ms", "6.4s", "41s", "2m 5s". */
export function formatMs(ms: Maybe): string {
  if (!isNum(ms)) return DASH;
  if (Math.abs(ms) < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return formatDuration(ms / 1000);
}

type TimeInput = string | number | Date | null | undefined;

function toMs(t: TimeInput): number | null {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Compact relative time: "just now", "12s ago", "5m ago", "3h ago", "2d ago", "in 38m".
 * `now` is injectable (ms or Date) so output is deterministic in tests and fixture mode.
 */
export function formatRelative(t: TimeInput, now: number | Date = Date.now()): string {
  const ms = toMs(t);
  const ref = toMs(now);
  if (ms == null || ref == null) return DASH;
  const diffSec = (ms - ref) / 1000;
  const abs = Math.abs(diffSec);
  if (abs < 5) return "just now";
  let unit: string;
  if (abs < 60) unit = `${Math.floor(abs)}s`;
  else if (abs < 3600) unit = `${Math.floor(abs / 60)}m`;
  else if (abs < 86_400) unit = `${Math.floor(abs / 3600)}h`;
  else if (abs < 86_400 * 30) unit = `${Math.floor(abs / 86_400)}d`;
  else if (abs < 86_400 * 365) unit = `${Math.floor(abs / (86_400 * 30))}mo`;
  else unit = `${Math.floor(abs / (86_400 * 365))}y`;
  return diffSec < 0 ? `${unit} ago` : `in ${unit}`;
}

/** Absolute UTC timestamp for tooltips: "2026-11-15 20:30 UTC". */
export function formatAbsolute(t: TimeInput): string {
  const ms = toMs(t);
  if (ms == null) return DASH;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
