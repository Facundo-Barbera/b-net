/** View-local formatters. Pure, no React. `nowMs` is always injected so output is deterministic. */

export type NowInput = number | string | Date | undefined;

export function toMs(now: NowInput): number {
  if (now === undefined) return Date.now();
  if (now instanceof Date) return now.getTime();
  if (typeof now === "string") return Date.parse(now);
  return now;
}

/** "just now", "5m ago", "26h ago", "4d ago"; future timestamps give "in 5m". */
export function relTime(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = nowMs - t;
  const abs = Math.abs(diff);
  const unit =
    abs < 45_000 ? null
    : abs < 3_600_000 ? `${Math.max(1, Math.round(abs / 60_000))}m`
    : abs < 48 * 3_600_000 ? `${Math.round(abs / 3_600_000)}h`
    : `${Math.round(abs / 86_400_000)}d`;
  if (unit === null) return "just now";
  return diff >= 0 ? `${unit} ago` : `in ${unit}`;
}

/** Age in ms of an ISO timestamp (null when unknown). */
export function ageMs(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : nowMs - t;
}

/** Compact duration: "45s", "6m", "14h 10m", "22d 1h". */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Elapsed since an ISO start time, e.g. "14m". */
export function since(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : duration((nowMs - t) / 1000);
}

/** Bytes/s (decimal units) -> "182 KB/s", "1.2 MB/s". */
export function rate(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "—";
  if (bps < 1_000) return `${Math.round(bps)} B/s`;
  if (bps < 1_000_000) return `${(bps / 1_000).toFixed(bps < 10_000 ? 1 : 0)} KB/s`;
  if (bps < 1_000_000_000) return `${(bps / 1_000_000).toFixed(1)} MB/s`;
  return `${(bps / 1_000_000_000).toFixed(1)} GB/s`;
}

/** "5.3 / 7.5 GB", switching to TB when the total is >= 1000 GB. */
export function usedOfTotal(usedGb: number, totalGb: number): string {
  if (totalGb >= 1000) return `${(usedGb / 1000).toFixed(1)} / ${(totalGb / 1000).toFixed(1)} TB`;
  const f = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
  return `${f(usedGb)} / ${f(totalGb)} GB`;
}

export const pct0 = (n: number) => `${Math.round(n)}%`;

export function ms(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${Math.round(n)} ms`;
}
