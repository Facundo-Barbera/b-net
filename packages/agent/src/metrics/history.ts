import type { MetricHistory } from "@bixku/core";

/** Fixed-size ring buffer of (cpu, mem) samples, oldest first, evenly spaced by `stepSec`. */
export class MetricHistoryBuffer {
  readonly capacity: number;
  readonly stepSec: number;
  #cpu: number[] = [];
  #mem: number[] = [];

  constructor(capacity = 30, stepSec = 60) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError("capacity must be a positive integer");
    if (!(stepSec > 0)) throw new RangeError("stepSec must be > 0");
    this.capacity = capacity;
    this.stepSec = stepSec;
  }

  get length(): number {
    return this.#cpu.length;
  }

  push(cpuPct: number, memPct: number): void {
    this.#cpu.push(round1(cpuPct));
    this.#mem.push(round1(memPct));
    if (this.#cpu.length > this.capacity) {
      this.#cpu.shift();
      this.#mem.shift();
    }
  }

  /** null until the first sample so the hub can tell "no history" from "flat zero". */
  toHistory(): MetricHistory | null {
    if (this.#cpu.length === 0) return null;
    return { stepSec: this.stepSec, cpuPct: [...this.#cpu], memPct: [...this.#mem] };
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
