/**
 * Pure parsers for system metric sources. No I/O: everything takes text and returns data,
 * so they are tested against fixture files in packages/agent/test/fixtures.
 */

export interface CpuTimes {
  /** idle + iowait (jiffies / ticks) */
  idle: number;
  /** sum of all accounted time */
  total: number;
}

const num = (s: string | undefined): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Aggregate `cpu ` line of /proc/stat. guest/guest_nice are already inside user/nice. */
export function parseProcStat(text: string): CpuTimes | null {
  const line = text.split("\n").find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const f = line.trim().split(/\s+/).slice(1).map(num);
  if (f.length < 4) return null;
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = f;
  return { idle: idle + iowait, total: user + nice + system + idle + iowait + irq + softirq + steal };
}

/** CPU busy % between two samples; null when there is no usable delta. */
export function cpuPctBetween(prev: CpuTimes, cur: CpuTimes): number | null {
  const dTotal = cur.total - prev.total;
  const dIdle = cur.idle - prev.idle;
  if (dTotal <= 0 || dIdle < 0) return null;
  return clampPct((1 - dIdle / dTotal) * 100);
}

/** os.cpus() entries -> CpuTimes (macOS / generic fallback). */
export function cpuTimesFromOs(
  cpus: ReadonlyArray<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }>,
): CpuTimes | null {
  if (cpus.length === 0) return null;
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

export interface MemInfo {
  totalBytes: number;
  usedBytes: number;
}

/** /proc/meminfo: used = MemTotal - MemAvailable (fallback: free + buffers + cache). */
export function parseMeminfo(text: string): MemInfo | null {
  const kb = new Map<string, number>();
  for (const l of text.split("\n")) {
    const m = /^([A-Za-z_()0-9]+):\s+(\d+)/.exec(l);
    if (m) kb.set(m[1]!, Number(m[2]));
  }
  const total = kb.get("MemTotal");
  if (!total) return null;
  let avail = kb.get("MemAvailable");
  if (avail === undefined) {
    avail = (kb.get("MemFree") ?? 0) + (kb.get("Buffers") ?? 0) + (kb.get("Cached") ?? 0);
  }
  return { totalBytes: total * 1024, usedBytes: Math.max(0, total - Math.min(avail, total)) * 1024 };
}

function firstNonNegative(text: string): number | null {
  const tok = text.trim().split(/\s+/)[0];
  if (!tok) return null;
  const n = Number(tok);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export const parseLoadavg = firstNonNegative;
export const parseUptime = firstNonNegative;

export interface NetTotals {
  rxBytes: number;
  txBytes: number;
}

/** Interfaces that would double count traffic or are not "the machine's network". */
const SKIP_IFACE = /^(lo|veth.*|docker.*|br-.*|virbr.*)$/;

/** /proc/net/dev -> total rx/tx bytes over physical-ish interfaces. */
export function parseNetDev(text: string): NetTotals | null {
  let rx = 0;
  let tx = 0;
  let seen = false;
  for (const l of text.split("\n")) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(l);
    if (!m || SKIP_IFACE.test(m[1]!)) continue;
    const f = m[2]!.trim().split(/\s+/);
    if (f.length < 9) continue;
    rx += num(f[0]);
    tx += num(f[8]);
    seen = true;
  }
  return seen ? { rxBytes: rx, txBytes: tx } : null;
}

/** macOS interfaces that would double count (tunnels such as Tailscale's utun, AWDL, bridges) or are loopback. */
const SKIP_IFACE_MAC = /^(lo\d*|utun\d*|awdl\d*|llw\d*|bridge\d*|gif\d*|stf\d*|anpi\d*|ap\d+)$/;

/**
 * macOS `netstat -ib -n`: sum Ibytes/Obytes of the link-level rows (`<Link#N>`).
 * Columns are counted from the right because Address is empty for some interfaces:
 * ... Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll.
 */
export function parseNetstatIb(text: string): NetTotals | null {
  let rx = 0;
  let tx = 0;
  let seen = false;
  for (const l of text.split("\n")) {
    const f = l.trim().split(/\s+/);
    if (f.length < 10 || !f[2]?.startsWith("<Link#")) continue;
    const name = f[0]!.replace(/\*$/, "");
    if (SKIP_IFACE_MAC.test(name)) continue;
    const ib = Number(f[f.length - 5]);
    const ob = Number(f[f.length - 2]);
    if (!Number.isFinite(ib) || !Number.isFinite(ob)) continue;
    rx += ib;
    tx += ob;
    seen = true;
  }
  return seen ? { rxBytes: rx, txBytes: tx } : null;
}

/** Bytes/s between two cumulative counters; null on counter reset or zero elapsed time. */
export function ratePerSec(prev: number, cur: number, elapsedSec: number): number | null {
  if (elapsedSec <= 0 || cur < prev) return null;
  return (cur - prev) / elapsedSec;
}

export interface DiskInfo {
  totalBytes: number;
  usedBytes: number;
}

/** `df -k <path>` (Linux and macOS). Tolerates filesystem names with spaces. */
export function parseDfK(text: string): DiskInfo | null {
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  for (const line of lines.slice(1).reverse()) {
    const m = /\s(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%/.exec(line);
    if (m) {
      const used = Number(m[2]) * 1024;
      const avail = Number(m[3]) * 1024;
      // same convention as df: capacity = used / (used + avail)
      return { totalBytes: used + avail, usedBytes: used };
    }
  }
  return null;
}

/** statfs result -> disk usage, using df's convention (excludes root-reserved blocks). */
export function diskFromStatfs(s: { bsize: number; blocks: number; bfree: number; bavail: number }): DiskInfo | null {
  if (!(s.blocks > 0) || !(s.bsize > 0)) return null;
  const used = (s.blocks - s.bfree) * s.bsize;
  const avail = s.bavail * s.bsize;
  return { totalBytes: used + avail, usedBytes: used };
}

/**
 * macOS `vm_stat`. Used = total - (free + inactive + speculative + purgeable): the pages
 * the OS can hand out without swapping. `totalBytes` comes from os.totalmem().
 */
export function parseVmStat(text: string, totalBytes: number): MemInfo | null {
  const ps = /page size of (\d+) bytes/.exec(text);
  if (!ps) return null;
  const pageSize = Number(ps[1]);
  const pages = new Map<string, number>();
  for (const l of text.split("\n")) {
    const m = /^"?([^":]+)"?:\s+(\d+)\.?\s*$/.exec(l.trim());
    if (m) pages.set(m[1]!.trim(), Number(m[2]));
  }
  if (!pages.has("Pages free")) return null;
  const reclaimable =
    (pages.get("Pages free") ?? 0) +
    (pages.get("Pages inactive") ?? 0) +
    (pages.get("Pages speculative") ?? 0) +
    (pages.get("Pages purgeable") ?? 0);
  const used = Math.max(0, totalBytes - reclaimable * pageSize);
  return { totalBytes, usedBytes: Math.min(used, totalBytes) };
}

/** Raw /sys/class/thermal/thermal_zone*\/temp values (millidegrees C) -> hottest plausible °C. */
export function parseThermalZones(rawValues: readonly string[]): number | null {
  const temps = rawValues
    .map((v) => Number(v.trim()) / 1000)
    .filter((t) => Number.isFinite(t) && t > 0 && t < 150);
  return temps.length > 0 ? Math.max(...temps) : null;
}

export function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

export const BYTES_PER_GB = 1024 ** 3;
export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface GpuReading {
  name: string;
  count: number;
  utilPct: number | null;
  memUsedMb: number | null;
  memTotalMb: number | null;
  tempC: number | null;
}

/** Field list for `nvidia-smi --query-gpu=... --format=csv,noheader,nounits` (order matters for the parser). */
export const NVIDIA_SMI_QUERY = "name,utilization.gpu,memory.used,memory.total,temperature.gpu";

/**
 * One CSV line per GPU: `name, util, memUsed, memTotal, temp`. Fields are read from the right so a
 * comma in the name cannot shift them; "[N/A]" / "[Not Supported]" become null. Several GPUs are
 * folded: max util and temp, summed memory.
 */
export function parseNvidiaSmi(text: string): GpuReading | null {
  const val = (s: string | undefined): number | null => {
    const n = Number(s?.trim());
    return s !== undefined && s.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  const maxOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));
  const sumOf = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);
  let out: GpuReading | null = null;
  for (const line of text.split("\n")) {
    const f = line.split(",");
    if (f.length < 5) continue;
    const temp = val(f.pop());
    const total = val(f.pop());
    const used = val(f.pop());
    const util = val(f.pop());
    const name = f.join(",").trim().slice(0, 128);
    if (!name) continue;
    out = out
      ? { name: out.name, count: out.count + 1, utilPct: maxOf(out.utilPct, util), memUsedMb: sumOf(out.memUsedMb, used), memTotalMb: sumOf(out.memTotalMb, total), tempC: maxOf(out.tempC, temp) }
      : { name, count: 1, utilPct: util, memUsedMb: used, memTotalMb: total, tempC: temp };
  }
  if (out?.utilPct != null) out.utilPct = clampPct(out.utilPct);
  return out;
}

/** WSL kernels say so in /proc/sys/kernel/osrelease ("...-microsoft-standard-WSL2"). */
export function isWslRelease(osrelease: string): boolean {
  return /microsoft|wsl/i.test(osrelease);
}
