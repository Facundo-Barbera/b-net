import type { MachineMetrics, MetricHistory } from "@bixku/core";
import type { Collector } from "./metrics/collector.ts";
import { MetricHistoryBuffer } from "./metrics/history.ts";

export interface MetricsSnapshot {
  at: Date;
  metrics: MachineMetrics;
  history: MetricHistory | null;
}

/**
 * Keeps the latest sample plus the ring buffer. `tick()` is driven by a timer in serve.ts
 * (never started by this module), so tests call it directly with a fake collector/clock.
 */
export class Sampler {
  #latest: { at: Date; metrics: MachineMetrics } | null = null;
  #inflight: Promise<void> | null = null;

  readonly #collector: Collector;
  readonly #history: MetricHistoryBuffer;
  readonly #now: () => Date;

  constructor(collector: Collector, history: MetricHistoryBuffer, now: () => Date = () => new Date()) {
    this.#collector = collector;
    this.#history = history;
    this.#now = now;
  }

  tick(): Promise<void> {
    // Coalesce overlapping ticks so the delta-based counters stay consistent.
    this.#inflight ??= (async () => {
      try {
        const metrics = await this.#collector.sample();
        this.#latest = { at: this.#now(), metrics };
        this.#history.push(metrics.cpuPct, metrics.memPct);
      } finally {
        this.#inflight = null;
      }
    })();
    return this.#inflight;
  }

  /** Latest sample; takes one first if the timer has not fired yet. */
  async snapshot(): Promise<MetricsSnapshot> {
    if (!this.#latest) await this.tick();
    const latest = this.#latest!;
    return { ...latest, history: this.#history.toHistory() };
  }
}
