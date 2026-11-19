/**
 * One set of display thresholds for the whole UI. Every meter, tone and "stale"/"slow" flag
 * reads from here so the same value never looks healthy in one view and alarming in another.
 * All comparisons are inclusive (`value >= limit`).
 */

/** Usage percentage (CPU, RAM, disk, quota windows) at/above which a meter turns amber. */
export const USAGE_WARN_AT = 70;
/** Usage percentage at/above which a meter turns red. */
export const USAGE_DANGER_AT = 90;

/** Temperature (°C) thresholds for machine sensors. */
export const TEMP_WARN_C = 75;
export const TEMP_DANGER_C = 85;

/** Tailscale latency (ms) above which the "worst latency" summary is flagged. */
export const LATENCY_WARN_MS = 250;

/** Metrics older than this (ms) are shown as stale. */
export const STALE_METRICS_MS = 5 * 60_000;
