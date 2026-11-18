import { formatCountdown, formatRelativeSpan } from "./format.ts";

/**
 * UI copy is Spanish (status names stay as the product enums: online, degraded, cooldown...).
 * These adapters feed `RelativeTime`'s `format` prop so the wording stays in one place.
 */
type When = string | number | Date;

/** "hace 22m" / "en 2h 10m". */
export const spanEs = (value: When, now: number): string => formatRelativeSpan(value, now, { lang: "es" });

/** Same, with second resolution for fresh events: "hace 12s". */
export const spanEsSeconds = (value: When, now: number): string => formatRelativeSpan(value, now, { lang: "es", seconds: true });

/** "resetea en 38m", or "reset pendiente" once the instant has passed. */
export const resetText = (value: When, now: number): string => {
  const left = formatCountdown(value, now);
  return left ? `resetea en ${left}` : "reset pendiente";
};

/** "en 200d 5h", or "vencido" once the instant has passed. */
export const expiresText = (value: When, now: number): string => {
  const left = formatCountdown(value, now);
  return left ? `en ${left}` : "vencido";
};
