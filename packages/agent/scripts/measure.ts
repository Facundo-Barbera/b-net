/**
 * Measures the real cost of the push agent (Linux, reads /proc). Bounded: it always ends.
 *
 *   node packages/agent/scripts/measure.ts --duration 240 --interval 30 -- <agent command...>
 *   e.g. -- node packages/agent/dist/fhub-agent.mjs     or     -- packages/agent/dist/fhub-agent
 *
 * Starts a throwaway ingest sink on 127.0.0.1 (random port) that checks the bearer token and
 * validates every body with the core AgentMetricsPush contract, runs the agent against it, samples
 * VmRSS and utime+stime every 2 s, then stops both and prints one JSON line. The sink and the
 * agent are killed on every exit path, and a hard deadline exits even if something hangs.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { AgentMetricsPush } from "@fhub/core";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
const opt = (name: string, def: number) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i < sep ? Number(argv[i + 1]) : def;
};
const durationSec = opt("duration", 240);
const intervalSec = opt("interval", 30);
const cmd = sep >= 0 ? argv.slice(sep + 1) : [];
if (cmd.length === 0 || process.platform !== "linux") {
  console.error("usage (Linux): measure.ts [--duration s] [--interval s] -- <agent command...>");
  process.exit(2);
}

const hz = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100;
const token = `measure_${randomBytes(24).toString("base64url")}`;
let received = 0;
let valid = 0;
let lastBody: unknown = null;

const sink = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    received++;
    const okAuth = req.headers.authorization === `Bearer ${token}`;
    let body: unknown = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {}
    if (okAuth && AgentMetricsPush.safeParse(body).success) (valid++, (lastBody = body));
    res.writeHead(okAuth ? 204 : 401).end();
  });
});

function procSample(pid: number): { rssKb: number; hwmKb: number; cpuSec: number } | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(status)?.[1] ?? 0);
    // Fields after the parenthesised comm: utime is the 12th, stime the 13th.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return { rssKb: kb("VmRSS"), hwmKb: kb("VmHWM"), cpuSec: (Number(f[11]) + Number(f[12])) / hz };
  } catch {
    return null;
  }
}

sink.listen(0, "127.0.0.1", () => {
  const port = (sink.address() as { port: number }).port;
  const startedAt = Date.now();
  const child = spawn(cmd[0]!, cmd.slice(1), {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: process.env.HOME ?? "/tmp",
      AGENT_HUB_URL: `http://127.0.0.1:${port}`,
      AGENT_MACHINE_ID: "measure",
      AGENT_TOKEN: token,
      AGENT_INTERVAL_SEC: String(intervalSec),
    },
  });
  const samples: Array<{ t: number; rssKb: number; hwmKb: number; cpuSec: number }> = [];
  const poll = setInterval(() => {
    const s = child.pid ? procSample(child.pid) : null;
    if (s) samples.push({ t: (Date.now() - startedAt) / 1000, ...s });
  }, 2000);

  let done = false;
  const finish = (reason: string) => {
    if (done) return;
    done = true;
    clearInterval(poll);
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    sink.close();
    // Steady state = after the first 10 s (startup, module load and the priming sample excluded).
    const steady = samples.filter((s) => s.t >= 10);
    const first = steady[0];
    const last = steady.at(-1);
    const span = first && last ? last.t - first.t : 0;
    const rss = steady.map((s) => s.rssKb);
    console.log(
      JSON.stringify({
        command: cmd.join(" "),
        reason,
        durationSec: Math.round((Date.now() - startedAt) / 1000),
        intervalSec,
        pushesReceived: received,
        pushesValid: valid,
        rssMiB: rss.length ? { avg: +(rss.reduce((a, b) => a + b, 0) / rss.length / 1024).toFixed(1), max: +(Math.max(...rss) / 1024).toFixed(1) } : null,
        peakRssMiB: last ? +(last.hwmKb / 1024).toFixed(1) : null,
        cpuSecTotal: last ? +last.cpuSec.toFixed(2) : null,
        cpuSecSteady: first && last ? +(last.cpuSec - first.cpuSec).toFixed(2) : null,
        cpuPctSteady: span > 0 ? +(((last!.cpuSec - first!.cpuSec) / span) * 100).toFixed(3) : null,
        cpuMsPerPush: span > 0 ? +((((last!.cpuSec - first!.cpuSec) * 1000) / (span / intervalSec))).toFixed(1) : null,
        lastPayloadBytes: lastBody ? JSON.stringify(lastBody).length : null,
      }),
    );
    setTimeout(() => process.exit(valid > 0 ? 0 : 1), 2500).unref();
  };
  child.on("exit", (code) => finish(`agent exited early (code ${code})`));
  setTimeout(() => finish("duration reached"), durationSec * 1000);
  // Hard deadline: nothing outlives this script.
  setTimeout(() => {
    child.kill("SIGKILL");
    process.exit(3);
  }, (durationSec + 20) * 1000).unref();
});
