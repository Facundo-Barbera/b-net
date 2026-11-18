/**
 * Production entrypoint: `node packages/hub/src/serve.ts` on bixku-homelab ONLY.
 * Never run on bixku-vps (dev machine). Binds to HUB_LISTEN_HOST (Tailscale IP), never 0.0.0.0.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { createBeszelClient } from "@b-net/core/clients/beszel";
import { createCliSource, createLocalApiSource, unixSocketRequester, type ExecFn } from "@b-net/core/clients/tailscale";
import { loadHubConfig } from "./config.ts";
import { createHandler, fsStaticReader, type Handler } from "./http.ts";
import { createHub } from "./hub.ts";
import { DeliverableFiles } from "./deliverables.ts";
import { createProjectsApi, type ProjectsApi } from "./projects-http.ts";
import type { ProjectStore } from "./projects-store.ts";
import { MemoryUsageStore, type UsageStore } from "./store.ts";

const execNoThrow: ExecFn = (file, args, opts) =>
  new Promise((res) => {
    execFile(file, args, { timeout: opts.timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      res({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });

export function toRequest(req: IncomingMessage, host: string): Request {
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
  if (req.method !== "POST") return new Request(url, { method: req.method, headers });
  // The body stays a stream (duplex: "half") so uploads go to disk chunk by chunk, never buffered whole.
  const body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
  return new Request(url, { method: req.method, headers, body, duplex: "half" } as RequestInit);
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
    handler(toRequest(req, `${host}:${port}`))
      .then((r) => writeResponse(res, r))
      .catch(() => {
        res.writeHead(500, { "content-type": "application/json" });
        res.end('{"error":"internal error"}');
      });
  });
  // Node's default 5 min request timeout would cut a 1 GiB upload on a slow tailnet link.
  server.requestTimeout = 60 * 60 * 1000;
  server.listen(port, host);
  return server;
}

async function main() {
  const cfg = loadHubConfig(process.env, (p) => readFileSync(p, "utf8"));

  let store: UsageStore = new MemoryUsageStore();
  let projectStore: ProjectStore | null = null;
  let projects: ProjectsApi | null = null;
  if (cfg.dataDir) {
    mkdirSync(cfg.dataDir, { recursive: true });
    const dbPath = join(cfg.dataDir, "hub.sqlite");
    const { SqliteUsageStore } = await import("./store-sqlite.ts");
    store = new SqliteUsageStore(dbPath);
    const { ProjectStore } = await import("./projects-store.ts");
    projectStore = new ProjectStore(dbPath);
    const files = new DeliverableFiles(join(cfg.dataDir, "deliverables"));
    await files.init();
    projects = createProjectsApi({ store: projectStore, files, quotaBytes: cfg.deliverablesQuotaBytes });
  }

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
    pollFastSec: cfg.pollFastSec,
    pollAgentSec: cfg.pollAgentSec,
  });

  const webDir = cfg.webDir ?? resolve(import.meta.dirname, "../../web/dist/app");
  const handler = createHandler({
    snapshot: hub.snapshot,
    store,
    apiToken: cfg.apiToken,
    staticFiles: existsSync(join(webDir, "index.html")) ? fsStaticReader(webDir) : null,
    projects,
    botTokens: cfg.botTokens,
  });

  const stop = hub.start();
  const server = mount(handler, cfg.listenHost, cfg.listenPort);
  console.log(`b-net listening on ${cfg.listenHost}:${cfg.listenPort} (machines: ${cfg.machines.length}, auth: ${cfg.apiToken ? "on" : "off"}, bots: ${cfg.botTokens.length}, projects: ${projects ? "on" : "off"})`);
  const shutdown = () => {
    stop();
    server.close(() => {
      store.close?.();
      projectStore?.close();
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
