import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statfsSync } from "node:fs";
import os from "node:os";
import { promisify } from "node:util";
import type { MachineMetrics } from "@b-net/core";
import {
  BYTES_PER_GB,
  clampPct,
  cpuPctBetween,
  cpuTimesFromOs,
  diskFromStatfs,
  isWslRelease,
  NVIDIA_SMI_QUERY,
  parseNvidiaSmi,
  parseDfK,
  parseLoadavg,
  parseMeminfo,
  parseNetDev,
  parseNetstatIb,
  parseProcStat,
  parseThermalZones,
  parseUptime,
  parseVmStat,
  ratePerSec,
  round2,
  type CpuTimes,
  type DiskInfo,
  type GpuReading,
  type MemInfo,
  type NetTotals,
} from "./parsers.ts";

/** Everything the collector touches in the outside world, injectable for tests. */
export interface CollectorDeps {
  platform: NodeJS.Platform;
  readFile(path: string): Promise<string>;
  listDir(path: string): Promise<string[]>;
  statfs(path: string): Promise<{ bsize: number; blocks: number; bfree: number; bavail: number }>;
  /** Runs a binary with args (no shell). Resolves with stdout; rejects on timeout (default 5 s). */
  exec(cmd: string, args: string[], opts?: { timeoutMs?: number }): Promise<string>;
  /** File existence (used once, to find nvidia-smi). Absent = no GPU probing. */
  exists?(path: string): boolean;
  /** Environment (PATH, WSL_DISTRO_NAME, AGENT_GPU). Absent = empty. */
  env?: Record<string, string | undefined>;
  os: {
    totalmem(): number;
    freemem(): number;
    uptime(): number;
    loadavg(): number[];
    cpus(): Array<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }>;
  };
  /** Monotonic-ish clock in ms. */
  now(): number;
}

const execFileP = promisify(execFile);

/**
 * Sync fs calls on purpose: /proc and /sys files report size 0, so the async readFile path does
 * several thread-pool round trips per file. Measured on Linux: ~2.7 ms CPU per async read of
 * /proc/stat vs ~0.03 ms sync, and these reads never block on disk.
 */
export function defaultCollectorDeps(): CollectorDeps {
  return {
    platform: process.platform,
    readFile: async (p) => readFileSync(p, "utf8"),
    listDir: async (p) => readdirSync(p),
    statfs: async (p) => {
      const s = statfsSync(p);
      return { bsize: Number(s.bsize), blocks: Number(s.blocks), bfree: Number(s.bfree), bavail: Number(s.bavail) };
    },
    exec: async (cmd, args, opts) =>
      (await execFileP(cmd, args, { timeout: opts?.timeoutMs ?? 5_000, killSignal: "SIGKILL", maxBuffer: 1 << 20 })).stdout,
    exists: (p) => existsSync(p),
    env: process.env,
    os,
    now: () => performance.timeOrigin + performance.now(),
  };
}

/** nvidia-smi can hang when the driver is wedged; never let it hold a sample longer than this. */
export const GPU_TIMEOUT_MS = 2_000;
/** After a failed nvidia-smi call, skip this many samples (5 min at 30 s) before trying again. */
export const GPU_BACKOFF_SAMPLES = 10;
/** Where WSL puts nvidia-smi (Windows driver passthrough); often missing from a systemd unit's PATH. */
const SMI_DIRS = ["/usr/bin", "/usr/local/bin", "/usr/lib/wsl/lib"];

export interface Collector {
  /** Takes one sample. CPU and network rates are deltas against the previous call. */
  sample(): Promise<MachineMetrics>;
}

async function attempt<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * Builds a collector. Linux (and WSL, which exposes the same /proc) reads /proc and statfs;
 * macOS uses the os module plus `vm_stat`, `df -k` and `netstat -ib`; any other platform gets the os-module
 * fallback (cpu, mem, load, uptime) with disk/net/temp left empty.
 * Every source fails soft: a missing file degrades one field instead of the whole sample.
 */
export function createCollector(deps: CollectorDeps): Collector {
  let prevCpu: CpuTimes | null = null;
  let prevNet: { at: number; totals: NetTotals } | null = null;

  const linux = deps.platform === "linux";
  const mac = deps.platform === "darwin";
  const env = deps.env ?? {};

  // Resolved once: the agent never spawns nvidia-smi on machines without it.
  let smiPath: string | null | undefined;
  let gpuSkip = 0;
  let wsl: boolean | undefined;

  function findNvidiaSmi(): string | null {
    if (!linux || !deps.exists || env["AGENT_GPU"] === "off") return null;
    const dirs = [...(env["PATH"] ?? "").split(":").filter((d) => d.startsWith("/")), ...SMI_DIRS];
    for (const d of dirs) {
      const p = `${d.replace(/\/+$/, "")}/nvidia-smi`;
      if (deps.exists(p)) return p;
    }
    return null;
  }

  /** undefined = no nvidia-smi (field omitted); null = present but no reading this time. */
  async function gpu(): Promise<GpuReading | null | undefined> {
    if (smiPath === undefined) smiPath = findNvidiaSmi();
    if (!smiPath) return undefined;
    if (gpuSkip > 0) {
      gpuSkip--;
      return null;
    }
    const path = smiPath;
    const r = await attempt(async () =>
      parseNvidiaSmi(await deps.exec(path, [`--query-gpu=${NVIDIA_SMI_QUERY}`, "--format=csv,noheader,nounits"], { timeoutMs: GPU_TIMEOUT_MS })),
    );
    if (r === null) gpuSkip = GPU_BACKOFF_SAMPLES;
    return r;
  }

  async function isWsl(): Promise<boolean> {
    if (!linux) return false;
    wsl ??= Boolean(env["WSL_DISTRO_NAME"]) || ((await attempt(async () => isWslRelease(await deps.readFile("/proc/sys/kernel/osrelease")))) ?? false);
    return wsl;
  }

  async function cpuTimes(): Promise<CpuTimes | null> {
    if (linux) {
      const t = await attempt(async () => parseProcStat(await deps.readFile("/proc/stat")));
      if (t) return t;
    }
    return cpuTimesFromOs(deps.os.cpus());
  }

  async function memory(): Promise<MemInfo> {
    if (linux) {
      const m = await attempt(async () => parseMeminfo(await deps.readFile("/proc/meminfo")));
      if (m) return m;
    }
    const total = deps.os.totalmem();
    if (mac) {
      const m = await attempt(async () => parseVmStat(await deps.exec("vm_stat", []), total));
      if (m) return m;
    }
    return { totalBytes: total, usedBytes: Math.max(0, total - deps.os.freemem()) };
  }

  async function disk(): Promise<DiskInfo | null> {
    if (linux) {
      const d = await attempt(async () => diskFromStatfs(await deps.statfs("/")));
      if (d) return d;
    }
    if (mac) {
      // On APFS "/" is the read-only system volume; user data (and the real usage) is on the Data volume.
      for (const mount of ["/System/Volumes/Data", "/"]) {
        const d = await attempt(async () => parseDfK(await deps.exec("df", ["-k", mount])));
        if (d) return d;
      }
      return null;
    }
    return attempt(async () => parseDfK(await deps.exec("df", ["-k", "/"])));
  }

  async function load1(): Promise<number | null> {
    if (linux) {
      const l = await attempt(async () => parseLoadavg(await deps.readFile("/proc/loadavg")));
      if (l !== null) return l;
    }
    if (deps.platform === "win32") return null; // os.loadavg() is always 0 on Windows
    return deps.os.loadavg()[0] ?? null;
  }

  async function uptime(): Promise<number | null> {
    if (linux) {
      const u = await attempt(async () => parseUptime(await deps.readFile("/proc/uptime")));
      if (u !== null) return u;
    }
    return deps.os.uptime();
  }

  async function netRates(): Promise<{ rx: number | null; tx: number | null }> {
    if (!linux && !mac) return { rx: null, tx: null };
    const totals = linux
      ? await attempt(async () => parseNetDev(await deps.readFile("/proc/net/dev")))
      : await attempt(async () => parseNetstatIb(await deps.exec("netstat", ["-ib", "-n"])));
    if (!totals) return { rx: null, tx: null };
    const at = deps.now();
    const prev = prevNet;
    prevNet = { at, totals };
    if (!prev) return { rx: null, tx: null };
    const dt = (at - prev.at) / 1000;
    return { rx: ratePerSec(prev.totals.rxBytes, totals.rxBytes, dt), tx: ratePerSec(prev.totals.txBytes, totals.txBytes, dt) };
  }

  async function temperature(): Promise<number | null> {
    if (!linux) return null;
    return attempt(async () => {
      const base = "/sys/class/thermal";
      const zones = (await deps.listDir(base)).filter((n) => /^thermal_zone\d+$/.test(n));
      const raw: string[] = [];
      for (const z of zones) {
        const v = await attempt(() => deps.readFile(`${base}/${z}/temp`));
        if (v !== null) raw.push(v);
      }
      return parseThermalZones(raw);
    });
  }

  return {
    async sample() {
      const [cpu, mem, dsk, load, up, net, temp, g, inWsl] = await Promise.all([
        cpuTimes(),
        memory(),
        disk(),
        load1(),
        uptime(),
        netRates(),
        temperature(),
        gpu(),
        isWsl(),
      ]);

      // First sample has no previous delta: fall back to the average since boot.
      let cpuPct = 0;
      if (cpu) {
        const base: CpuTimes = prevCpu ?? { idle: 0, total: 0 };
        cpuPct = cpuPctBetween(base, cpu) ?? 0;
        prevCpu = cpu;
      }

      const memPct = mem.totalBytes > 0 ? (mem.usedBytes / mem.totalBytes) * 100 : 0;
      const diskTotal = dsk?.totalBytes ?? 0;
      const diskPct = diskTotal > 0 ? ((dsk?.usedBytes ?? 0) / diskTotal) * 100 : 0;

      return {
        cpuPct: round2(cpuPct),
        memPct: round2(clampPct(memPct)),
        memUsedGb: round2(mem.usedBytes / BYTES_PER_GB),
        memTotalGb: round2(mem.totalBytes / BYTES_PER_GB),
        diskPct: round2(clampPct(diskPct)),
        diskUsedGb: round2((dsk?.usedBytes ?? 0) / BYTES_PER_GB),
        diskTotalGb: round2(diskTotal / BYTES_PER_GB),
        load1: load === null ? null : round2(load),
        netRxBps: net.rx === null ? null : Math.round(net.rx),
        netTxBps: net.tx === null ? null : Math.round(net.tx),
        uptimeSec: up === null ? null : Math.round(up),
        tempC: temp === null ? null : round2(temp),
        // Optional keys stay absent (not null) when they do not apply, so Beszel-shaped data is unchanged.
        ...(g === undefined
          ? {}
          : {
              gpu: g && {
                name: g.name,
                count: g.count,
                utilPct: g.utilPct === null ? null : round2(g.utilPct),
                memUsedMb: g.memUsedMb === null ? null : Math.round(g.memUsedMb),
                memTotalMb: g.memTotalMb === null ? null : Math.round(g.memTotalMb),
                tempC: g.tempC === null ? null : round2(g.tempC),
              },
            }),
        ...(inWsl ? { wslVm: true } : {}),
      };
    },
  };
}
