import { describe, expect, it } from "vitest";
import { MachineMetrics } from "@b-net/core";
import { createCollector, type CollectorDeps } from "../src/metrics/collector.ts";
import { MetricHistoryBuffer } from "../src/metrics/history.ts";
import { Sampler } from "../src/sampler.ts";
import { fx } from "./helpers.ts";

function fakeDeps(over: Partial<CollectorDeps> & { files?: () => Record<string, string | undefined> }): CollectorDeps {
  const files: () => Record<string, string | undefined> = over.files ?? (() => ({}));
  return {
    platform: "linux",
    readFile: async (p) => {
      const v = files()[p];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    listDir: async (p) => {
      if (p !== "/sys/class/thermal") throw new Error("ENOENT");
      return ["cooling_device0", "thermal_zone0", "thermal_zone1"];
    },
    statfs: async () => ({ bsize: 4096, blocks: 1_000_000, bfree: 400_000, bavail: 350_000 }),
    exec: async () => {
      throw new Error("exec not expected");
    },
    os: {
      totalmem: () => 8 * 1024 ** 3,
      freemem: () => 2 * 1024 ** 3,
      uptime: () => 100,
      loadavg: () => [1.5, 1, 1],
      cpus: () => [{ times: { user: 10, nice: 0, sys: 10, idle: 80, irq: 0 } }],
    },
    now: () => 0,
    ...over,
  };
}

describe("Linux collector (also WSL)", () => {
  it("first sample is the since-boot average, second sample is a delta; net rates need two samples", async () => {
    let tick = 0;
    let clock = 1_000_000;
    const snapshots = [
      {
        "/proc/stat": fx("proc-stat-1.txt"),
        "/proc/net/dev": fx("net-dev-1.txt"),
      },
      {
        "/proc/stat": fx("proc-stat-2.txt"),
        "/proc/net/dev": fx("net-dev-2.txt"),
      },
    ];
    const common = {
      "/proc/meminfo": fx("meminfo.txt"),
      "/proc/loadavg": fx("loadavg.txt"),
      "/proc/uptime": fx("uptime.txt"),
      "/sys/class/thermal/thermal_zone0/temp": "42000\n",
      "/sys/class/thermal/thermal_zone1/temp": "55250\n",
    };
    const c = createCollector(
      fakeDeps({ files: () => ({ ...common, ...snapshots[tick]! }), now: () => clock }),
    );

    const m1 = await c.sample();
    // since boot: busy = 1 - 8200/9800
    expect(m1.cpuPct).toBeCloseTo((1 - 8200 / 9800) * 100, 1);
    expect(m1.netRxBps).toBeNull();
    expect(m1.netTxBps).toBeNull();

    tick = 1;
    clock += 10_000;
    const m2 = await c.sample();
    expect(m2.cpuPct).toBe(40);
    expect(m2.netRxBps).toBe(80_000);
    expect(m2.netTxBps).toBe(35_000);

    expect(m2).toMatchObject({
      memPct: 50,
      memUsedGb: 7.81,
      memTotalGb: 15.63,
      load1: 0.52,
      uptimeSec: 86401,
      tempC: 55.25,
    });
    // statfs: used 600k blocks, avail 350k -> 63.16 %
    expect(m2.diskPct).toBeCloseTo(63.16, 1);
    expect(m2.diskTotalGb).toBeCloseTo((950_000 * 4096) / 1024 ** 3, 1);
    expect(MachineMetrics.safeParse(m2).success).toBe(true);
  });

  it("degrades per field when /proc files are missing (WSL-like: no thermal, no files at all)", async () => {
    const c = createCollector(fakeDeps({ listDir: async () => { throw new Error("ENOENT"); } }));
    const m = await c.sample();
    // falls back to the os module
    expect(m.memTotalGb).toBe(8);
    expect(m.memPct).toBe(75);
    expect(m.load1).toBe(1.5);
    expect(m.uptimeSec).toBe(100);
    expect(m.tempC).toBeNull();
    expect(MachineMetrics.safeParse(m).success).toBe(true);
  });

  it("net counter reset yields null instead of a negative rate", async () => {
    let n = 0;
    let clock = 0;
    const c = createCollector(
      fakeDeps({
        files: () => ({ "/proc/net/dev": fx(n === 0 ? "net-dev-2.txt" : "net-dev-1.txt") }),
        now: () => clock,
      }),
    );
    await c.sample();
    n = 1;
    clock = 10_000;
    const m = await c.sample();
    expect(m.netRxBps).toBeNull();
    expect(m.netTxBps).toBeNull();
  });
});

describe("macOS collector (injected exec)", () => {
  it("uses vm_stat and df -k on the Data volume", async () => {
    const calls: string[] = [];
    const c = createCollector(
      fakeDeps({
        platform: "darwin",
        os: {
          totalmem: () => 16 * 1024 ** 3,
          freemem: () => 0,
          uptime: () => 5000.4,
          loadavg: () => [2.25, 2, 2],
          cpus: () => [{ times: { user: 25, nice: 0, sys: 25, idle: 50, irq: 0 } }],
        },
        exec: async (cmd, args) => {
          calls.push([cmd, ...args].join(" "));
          if (cmd === "vm_stat") return fx("vm_stat.txt");
          if (cmd === "df" && args[1] === "/System/Volumes/Data") return fx("df-mac-data.txt");
          throw new Error("unexpected");
        },
      }),
    );
    const m = await c.sample();
    expect(calls).toEqual(["vm_stat", "df -k /System/Volumes/Data"]);
    expect(m.cpuPct).toBe(50);
    expect(m.memTotalGb).toBe(16);
    expect(m.memPct).toBeCloseTo(((16 * 1024 ** 3 - 140000 * 16384) / 16 / 1024 ** 3) * 100 * 1, 0);
    expect(m.diskPct).toBeCloseTo((500 / 900) * 100, 1);
    expect(m.load1).toBe(2.25);
    expect(m.uptimeSec).toBe(5000);
    expect(m.netRxBps).toBeNull();
    expect(m.tempC).toBeNull();
    expect(MachineMetrics.safeParse(m).success).toBe(true);
  });

  it("falls back to os.freemem and df / when vm_stat or the Data volume are unavailable", async () => {
    const c = createCollector(
      fakeDeps({
        platform: "darwin",
        exec: async (cmd, args) => {
          if (cmd === "df" && args[1] === "/") return fx("df-mac.txt");
          throw new Error("unexpected");
        },
      }),
    );
    const m = await c.sample();
    expect(m.memPct).toBe(75);
    expect(m.diskTotalGb).toBeGreaterThan(0);
  });
});

describe("Sampler + MetricHistoryBuffer", () => {
  it("ring buffer keeps the newest N points, oldest first", () => {
    const h = new MetricHistoryBuffer(3, 60);
    expect(h.toHistory()).toBeNull();
    for (const v of [1, 2, 3, 4, 5]) h.push(v, v * 10);
    expect(h.toHistory()).toEqual({ stepSec: 60, cpuPct: [3, 4, 5], memPct: [30, 40, 50] });
    expect(h.length).toBe(3);
  });

  it("rejects invalid sizes", () => {
    expect(() => new MetricHistoryBuffer(0)).toThrow();
    expect(() => new MetricHistoryBuffer(5, 0)).toThrow();
  });

  it("defaults to 30 points / 60 s and validates against MetricHistory", async () => {
    const h = new MetricHistoryBuffer();
    for (let i = 0; i < 45; i++) h.push(i % 100, 50);
    const hist = h.toHistory()!;
    expect(hist.cpuPct).toHaveLength(30);
    expect(hist.stepSec).toBe(60);
    const { MetricHistory } = await import("@b-net/core");
    expect(MetricHistory.safeParse(hist).success).toBe(true);
  });

  it("Sampler takes a sample on demand and appends one point per tick, coalescing overlaps", async () => {
    let calls = 0;
    const metrics = { ...(await createCollector(fakeDeps({})).sample()) };
    const s = new Sampler(
      { sample: async () => ({ ...metrics, cpuPct: ++calls }) },
      new MetricHistoryBuffer(30, 60),
      () => new Date("2026-01-01T00:00:00Z"),
    );
    const first = await s.snapshot();
    expect(first.at.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(first.history!.cpuPct).toEqual([1]);
    await Promise.all([s.tick(), s.tick()]); // one real sample
    expect(calls).toBe(2);
    expect((await s.snapshot()).history!.cpuPct).toEqual([1, 2]);
  });
});
