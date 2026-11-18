/**
 * Production entrypoint: `node packages/hub/src/serve.ts` on bixku-homelab ONLY.
 * Never run on bixku-vps (dev machine). Binds to HUB_LISTEN_HOST (Tailscale IP), never 0.0.0.0.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { INGEST_MAX_BYTES, IngestRoutes } from "@b-net/core";
import { createBeszelClient } from "@b-net/core/clients/beszel";
import { createCliSource, createLocalApiSource, unixSocketRequester, type ExecFn } from "@b-net/core/clients/tailscale";
import { loadHubConfig } from "./config.ts";
import { createHandler, fsStaticReader, type Handler } from "./http.ts";
import { createHub } from "./hub.ts";
import { createIngestHandler } from "./ingest.ts";
import { SqliteMetricsStore } from "./metrics-store.ts";
import { MemoryUsageStore, type UsageStore } from "./store.ts";

const execNoThrow: ExecFn = (file, args, opts) =>
  new Promise((res) => {
    execFile(file, args, { timeout: opts.timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      res({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });

class BodyTooLarge extends Error {}

/** Buffers a request body, giving up past `max` bytes so a client cannot make the hub hold more. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      // Past the cap, keep draining without storing so the 413 can still be written.
      if (size > max) reject(new BodyTooLarge());
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function toRequest(req: IncomingMessage, host: string): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
  // Only the ingest route takes a body; everything else is read-only and never consumes one.
  if (req.method === "POST" && url.pathname === IngestRoutes.metrics) {
    return new Request(url, { method: "POST", headers, body: new Uint8Array(await readBody(req, INGEST_MAX_BYTES)) });
  }
  return new Request(url, { method: req.method, headers });
}

async function writeResponse(res: ServerResponse, r: Response) {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(r.status, headers);
  if (!r.body) return void res.end();
  Readable.fromWeb(r.body as import("node:stream/web").ReadableStream).pipe(res);
}

export function mount(handler: Handler, host: string, port: number) {
  const server = createServer((req, res) => {
    toRequest(req, `${host}:${port}`)
      .then(handler)
      .then((r) => writeResponse(res, r))
      .catch((e) => {
        if (res.headersSent || res.destroyed) return;
        const tooLarge = e instanceof BodyTooLarge;
        res.writeHead(tooLarge ? 413 : 500, { "content-type": "application/json", connection: "close" });
        res.end(tooLarge ? '{"error":"payload too large"}' : '{"error":"internal error"}');
      });
  });
  server.listen(port, host);
  return server;
}

async function main() {
  const cfg = loadHubConfig(process.env, (p) => readFileSync(p, "utf8"));

  let store: UsageStore = new MemoryUsageStore();
  // Without HUB_DATA_DIR pushed metrics live in memory and no agent token exists, so ingest answers 401.
  let dbPath = ":memory:";
  if (cfg.dataDir) {
    mkdirSync(cfg.dataDir, { recursive: true });
    dbPath = join(cfg.dataDir, "hub.sqlite");
    const { SqliteUsageStore } = await import("./store-sqlite.ts");
    store = new SqliteUsageStore(dbPath);
  }
  const metrics = new SqliteMetricsStore(dbPath);

  const tailscale =
    cfg.tailscale.source === "cli"
      ? createCliSource({ exec: execNoThrow, binary: cfg.tailscale.binary })
      : createLocalApiSource({ request: unixSocketRequester(cfg.tailscale.socket) });

  const hub = createHub({
    machines: cfg.machines,
    hubMachineId: cfg.hubMachineId,
    fetch: globalThis.fetch,
    tailscale,
    beszel: cfg.beszel ? createBeszelClient({ baseUrl: cfg.beszel.url, email: cfg.beszel.email, password: cfg.beszel.password, fetch: globalThis.fetch }) : null,
    agentToken: cfg.agentToken,
    t3Exporters: cfg.t3Exporters,
    proxy: cfg.proxy,
    store,
    metrics,
    pollFastSec: cfg.pollFastSec,
    pollAgentSec: cfg.pollAgentSec,
  });

  const webDir = cfg.webDir ?? resolve(import.meta.dirname, "../../web/dist/app");
  const handler = createHandler({
    snapshot: hub.snapshot,
    store,
    apiToken: cfg.apiToken,
    staticFiles: existsSync(join(webDir, "index.html")) ? fsStaticReader(webDir) : null,
    ingest: createIngestHandler({ store: metrics, knownMachines: new Set(cfg.machines.map((m) => m.id)) }),
  });

  const stop = hub.start();
  const server = mount(handler, cfg.listenHost, cfg.listenPort);
  console.log(`b-net listening on ${cfg.listenHost}:${cfg.listenPort} (machines: ${cfg.machines.length}, auth: ${cfg.apiToken ? "on" : "off"})`);
  const shutdown = () => {
    stop();
    server.close(() => {
      store.close?.();
      metrics.close();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  main().catch((e) => {
    console.error(`b-net failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
