import type { SourceHealth } from "@fhub/core";

export type SourceName = SourceHealth["source"];
export type Clock = () => Date;

/** Strip anything that looks like a credential and bound the length. */
export function sanitizeError(e: unknown): string {
  const msg = e instanceof Error ? `${e.name === "Error" ? "" : `${e.name}: `}${e.message}` : String(e);
  return msg
    .replace(/(bearer|basic)\s+[^\s,;]+/gi, "$1 [redacted]")
    .replace(/(token|password|secret|key)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-[redacted]")
    .slice(0, 200);
}

/**
 * Tracks one data source: last good value, when it was fetched, and SourceHealth.
 * On failure the last value is kept (with its timestamp) so consumers can decide on staleness.
 */
export class SourceTracker<T> {
  readonly source: SourceName;
  readonly machineId: string | null;
  private readonly clock: Clock;
  value: T | null = null;
  valueAt: Date | null = null;
  private ok = false;
  private error: string | null = "not polled yet";

  constructor(source: SourceName, machineId: string | null, clock: Clock) {
    this.source = source;
    this.machineId = machineId;
    this.clock = clock;
  }

  async run(fn: () => Promise<T>): Promise<T | null> {
    try {
      const v = await fn();
      this.value = v;
      this.valueAt = this.clock();
      this.ok = true;
      this.error = null;
      return v;
    } catch (e) {
      this.ok = false;
      this.error = sanitizeError(e);
      return null;
    }
  }

  /** Last value if younger than maxAgeMs, else null. */
  fresh(maxAgeMs: number): T | null {
    if (!this.valueAt) return null;
    return this.clock().getTime() - this.valueAt.getTime() <= maxAgeMs ? this.value : null;
  }

  health(): SourceHealth {
    return {
      source: this.source,
      machineId: this.machineId,
      ok: this.ok,
      lastSuccessAt: this.valueAt?.toISOString() ?? null,
      error: this.ok ? null : this.error,
    };
  }
}
