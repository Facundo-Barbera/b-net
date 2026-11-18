import { describe, expect, it } from "vitest";
import {
  cpuPctBetween,
  cpuTimesFromOs,
  diskFromStatfs,
  parseDfK,
  parseNetstatIb,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseProcStat,
  parseThermalZones,
  parseUptime,
  parseVmStat,
  ratePerSec,
} from "../src/metrics/parsers.ts";
import { fx } from "./helpers.ts";


describe("/proc parsers", () => {
  it("parseProcStat reads the aggregate cpu line (idle includes iowait)", () => {
    expect(parseProcStat(fx("proc-stat-1.txt"))).toEqual({ idle: 8200, total: 9800 });
    expect(parseProcStat("intr 1 2 3")).toBeNull();
    expect(parseProcStat("cpu  1 2")).toBeNull();
  });

  it("cpuPctBetween computes the busy % from two samples", () => {
    const a = parseProcStat(fx("proc-stat-1.txt"))!;
    const b = parseProcStat(fx("proc-stat-2.txt"))!;
    expect(cpuPctBetween(a, b)).toBeCloseTo(40, 5);
    expect(cpuPctBetween(b, b)).toBeNull(); // no elapsed ticks
    expect(cpuPctBetween(b, a)).toBeNull(); // counters went backwards
  });

  it("cpuTimesFromOs sums per-core times", () => {
    const t = { user: 10, nice: 0, sys: 5, idle: 85, irq: 0 };
    expect(cpuTimesFromOs([{ times: t }, { times: t }])).toEqual({ idle: 170, total: 200 });
    expect(cpuTimesFromOs([])).toBeNull();
  });

  it("parseMeminfo uses MemAvailable, falls back on old kernels", () => {
    expect(parseMeminfo(fx("meminfo.txt"))).toEqual({ totalBytes: 16384000 * 1024, usedBytes: 8192000 * 1024 });
    const old = parseMeminfo(fx("meminfo-old.txt"))!;
    expect(old.usedBytes / old.totalBytes).toBeCloseTo(0.625, 5);
    expect(parseMeminfo("garbage")).toBeNull();
  });

  it("parseLoadavg / parseUptime", () => {
    expect(parseLoadavg(fx("loadavg.txt"))).toBe(0.52);
    expect(parseLoadavg("")).toBeNull();
    expect(parseUptime(fx("uptime.txt"))).toBeCloseTo(86400.55);
    expect(parseUptime("nope")).toBeNull();
  });

  it("parseNetDev sums real interfaces and skips lo/veth/docker", () => {
    expect(parseNetDev(fx("net-dev-1.txt"))).toEqual({ rxBytes: 1_200_000, txBytes: 500_000 });
    expect(parseNetDev("Inter-|\n face |bytes\n")).toBeNull();
  });

  it("ratePerSec handles resets and zero elapsed", () => {
    expect(ratePerSec(1_200_000, 2_000_000, 10)).toBe(80_000);
    expect(ratePerSec(10, 5, 10)).toBeNull();
    expect(ratePerSec(1, 2, 0)).toBeNull();
  });

  it("parseThermalZones picks the hottest plausible zone", () => {
    expect(parseThermalZones(["45000\n", "61500\n", "0\n", "999000\n"])).toBe(61.5);
    expect(parseThermalZones([])).toBeNull();
    expect(parseThermalZones(["abc"])).toBeNull();
  });
});

describe("disk parsers", () => {
  it("parseNetstatIb sums link rows, skips loopback/tunnels/AWDL and tolerates an empty Address", () => {
    expect(parseNetstatIb(fx("netstat-ib-mac.txt"))).toEqual({ rxBytes: 6_000_000_000 + 1_000_000 + 4000, txBytes: 900_000_000 + 500_000 + 3000 });
    expect(parseNetstatIb("garbage")).toBeNull();
  });

  it("parseDfK on Linux output", () => {
    const d = parseDfK(fx("df-linux.txt"))!;
    expect(d.usedBytes).toBe(20480000 * 1024);
    expect(d.totalBytes).toBe((20480000 + 28672000) * 1024);
  });

  it("parseDfK on macOS output (Capacity / iused columns)", () => {
    const d = parseDfK(fx("df-mac-data.txt"))!;
    expect(d.usedBytes).toBe(500000000 * 1024);
    expect(d.totalBytes).toBe(900000000 * 1024);
  });

  it("parseDfK tolerates filesystem names with spaces and returns null for junk", () => {
    expect(parseDfK(fx("df-spaces.txt"))).toEqual({ totalBytes: 1000 * 1024, usedBytes: 250 * 1024 });
    expect(parseDfK("nothing useful")).toBeNull();
  });

  it("diskFromStatfs follows df's convention (reserved blocks excluded)", () => {
    expect(diskFromStatfs({ bsize: 4096, blocks: 1000, bfree: 400, bavail: 350 })).toEqual({
      usedBytes: 600 * 4096,
      totalBytes: 950 * 4096,
    });
    expect(diskFromStatfs({ bsize: 4096, blocks: 0, bfree: 0, bavail: 0 })).toBeNull();
  });
});

describe("parseVmStat (macOS)", () => {
  it("derives used memory from reclaimable pages", () => {
    const total = 16 * 1024 ** 3;
    const m = parseVmStat(fx("vm_stat.txt"), total)!;
    const reclaimable = (20000 + 100000 + 5000 + 15000) * 16384;
    expect(m).toEqual({ totalBytes: total, usedBytes: total - reclaimable });
  });

  it("returns null when the output is not vm_stat", () => {
    expect(parseVmStat("command not found", 1)).toBeNull();
  });
});
