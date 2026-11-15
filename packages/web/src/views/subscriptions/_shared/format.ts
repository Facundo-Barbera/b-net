/**
 * View-local formatters shared by Subscriptions / Proxy / Secrets.
 * Pure functions, deterministic (en-US number formatting, Spanish copy), no Date.now() inside:
 * everything is computed against an injectable `now`.
 */

export type NowInput = string | number | Date;

/**
 * Reference clock for relative times. Default is the snapshot's own `generatedAt`
 * (a coherent frame: countdowns are consistent with the data, and fixtures stay deterministic).
 */
export function resolveNow(generatedAt: string, now?: NowInput): number {
  if (now === undefined) return Date.parse(generatedAt);
  if (now instanceof Date) return now.getTime();
  return typeof now === "number" ? now : Date.parse(now);
}

/** "2h 10m", "4d 3h", "38m", "<1m" (or "12s" with `seconds`). */
export function fmtSpan(ms: number, opts: { seconds?: boolean } = {}): string {
  const total = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return opts.seconds ? `${total}s` : "<1m";
}

/** Signed relative time: future => "en 2h 10m", past => "hace 22m". */
export function fmtRel(iso: string, nowMs: number, opts: { seconds?: boolean } = {}): string {
  const diff = Date.parse(iso) - nowMs;
  const span = fmtSpan(diff, opts);
  return diff > 0 ? `en ${span}` : `hace ${span}`;
}

/** Countdown to a future instant ("2h 10m"), or null when it is already past. */
export function countdown(iso: string | null, nowMs: number): string | null {
  if (!iso) return null;
  const diff = Date.parse(iso) - nowMs;
  return diff > 0 ? fmtSpan(diff) : null;
}

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtInt = (n: number): string => int.format(n);

/** Compact token counts: 840, 9.8k, 81M, 2.6B. */
export function fmtTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1_000) return String(n);
  const [div, suffix] = abs < 1e6 ? [1e3, "k"] : abs < 1e9 ? [1e6, "M"] : [1e9, "B"];
  const v = n / (div as number);
  const s = Math.abs(v) < 100 ? v.toFixed(1) : v.toFixed(0);
  return `${s.replace(/\.0$/, "")}${suffix}`;
}

/** "$41.26" with thousands separators, always 2 decimals. */
export const fmtUsd2 = (n: number): string => `$${money2.format(n)}`;

/** Headline money: no decimals from $1,000 up or for whole amounts ("$3,980", "$200"), otherwise 2 decimals. */
export const fmtUsd = (n: number): string => (Math.abs(n) >= 1_000 || Number.isInteger(n) ? `$${int.format(n)}` : fmtUsd2(n));

export function fmtMoney(n: number, currency: string): string {
  return currency === "USD" ? fmtUsd2(n) : `${money2.format(n)} ${currency}`;
}

/** Latency: 820 ms, 6.4 s, 41 s. */
export function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  const s = ms / 1_000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

export const fmtPct = (n: number, digits = 1): string => `${n.toFixed(digits).replace(/\.0+$/, "")}%`;

/** Port part of "host:port". */
export const portOf = (listen: string): string => listen.slice(listen.lastIndexOf(":"));
