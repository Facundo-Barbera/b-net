import { formatAbsolute, formatRelative } from "../lib/format.ts";
import { useNow } from "./now.tsx";

export interface RelativeTimeProps {
  /** ISO string / epoch ms / Date; null renders "—". */
  value: string | number | Date | null | undefined;
  /** Override the reference time (ms). Defaults to the shell's NowProvider, else the wall clock. */
  now?: number;
  /** Custom text, e.g. a precise or localized span: `(value, now) => formatRelativeSpan(value, now, { lang: "es" })`. */
  format?: (value: string | number | Date, now: number) => string;
  /** Text for null values (default "—"). */
  fallback?: string;
  className?: string;
}

/** `<time>` with compact relative text ("5m ago", "in 38m") and the absolute UTC time as tooltip. */
export function RelativeTime({ value, now, format, fallback = "—", className }: RelativeTimeProps) {
  const ctxNow = useNow();
  if (value == null) return <span className={className}>{fallback}</span>;
  const iso = value instanceof Date ? value.toISOString() : typeof value === "number" ? new Date(value).toISOString() : value;
  return (
    <time className={className} dateTime={iso} title={formatAbsolute(value)}>
      {(format ?? formatRelative)(value, now ?? ctxNow)}
    </time>
  );
}
