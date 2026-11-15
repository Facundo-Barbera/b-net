/**
 * Entry point: mounts the Fetch-API handler on node:http.
 * Run by systemd/launchd on each machine (see ../deploy). NEVER run on bixku-vps during development.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { readT3Threads } from "@b-net/core/clients/t3";
import { loadConfig } from "./config.ts";
import { createAgentHandler } from "./handler.ts";
import { createCollector, defaultCollectorDeps } from "./metrics/collector.ts";
import { MetricHistoryBuffer } from "./metrics/history.ts";
import { Sampler } from "./sampler.ts";
import { AGENT_VERSION } from "./version.ts";

function toRequest(req: IncomingMessage, origin: string): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else if (v !== undefined) headers.set(k, v);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(new URL(req.url ?? "/", origin), {
    method,
    headers,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" } : {}),
  } as RequestInit);
}

async function send(res: ServerResponse, r: Response): Promise<void> {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => {
    headers[k] = v;
  });
  res.writeHead(r.status, headers);
  res.end(r.body ? Buffer.from(await r.arrayBuffer()) : undefined);
}

export function main(): void {
  const config = loadConfig(process.env, (p) => readFileSync(p, "utf8"));
  const sampler = new Sampler(
    createCollector(defaultCollectorDeps()),
    new MetricHistoryBuffer(config.historyPoints, config.sampleIntervalSec),
  );
  const handler = createAgentHandler({
    machineId: config.machineId,
    token: config.token,
    version: AGENT_VERSION,
    startedAt: new Date(),
    getMetrics: () => sampler.snapshot(),
    readThreads: () => readT3Threads({ machineId: config.machineId, ...(config.t3DbPath ? { dbPath: config.t3DbPath } : {}) }),
  });

  void sampler.tick();
  setInterval(() => void sampler.tick().catch(() => {}), config.sampleIntervalSec * 1000).unref();

  const origin = `http://${config.listenHost}:${config.port}`;
  const server = createServer((req, res) => {
    handler(toRequest(req, origin))
      .then((r) => send(res, r))
      .catch(() => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end('{"error":"internal_error"}');
      });
  });
  server.listen(config.port, config.listenHost, () => {
    console.log(`b-net-agent ${AGENT_VERSION} listening on ${config.listenHost}:${config.port} (machine ${config.machineId})`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
