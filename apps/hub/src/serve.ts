/**
 * Production entrypoint: `node apps/hub/src/serve.ts` on bixku-homelab ONLY.
 * Never run on bixku-vps (dev machine). Binds to HUB_LISTEN_HOST (Tailscale IP), never 0.0.0.0.
 * Loads its own env file (HUB_ENV_FILE, default: .env at the repo root) so it starts the same way
 * from systemd, a shell or a process manager, without `--env-file` or `set -a; source .env`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { INGEST_MAX_BYTES, IngestRoutes, type ProjectSummary } from "@fhub/core";
import { createBeszelClient } from "@fhub/core/clients/beszel";
import { createCliSource, createLocalApiSource, unixSocketRequester, type ExecFn } from "@fhub/core/clients/tailscale";
import { ConfigError, loadHubConfig, withEnvFile } from "./config.ts";
import { createBoardAuthenticate, type BoardAuthenticate } from "./board/auth.ts";
import { loadBoardConfig } from "./board/config.ts";
import type { SqliteBoardTokenStore } from "./board/tokens.ts";
import { createHandler, fsStaticReader, isBoardPath, type Handler } from "./http.ts";
import { createHub } from "./hub.ts";
import { DeliverableFiles } from "./deliverables.ts";
import { createIngestHandler } from "./ingest.ts";
import { SqliteMetricsStore } from "./metrics-store.ts";
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

export function toRequest(req: IncomingMessage, host: string): Request {
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
  // Board's protocol is GET and POST; anything else with a body still streams instead of being dropped.
  if (req.method === "GET" || req.method === "HEAD" || !req.method) return new Request(url, { method: req.method, headers });
  // Deliverable uploads stay a stream (duplex: "half") so they go to disk chunk by chunk, never buffered whole.
  const body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
  return new Request(url, { method: req.method, headers, body, duplex: "half" } as RequestInit);
}

/** Ingest bodies are small and capped; everything else uses the streaming adapter. */
async function adaptRequest(req: IncomingMessage, host: string): Promise<Request> {
  const url = new URL(req.url ?? "/", `http://${host}`);
  if (req.method === "POST" && url.pathname === IngestRoutes.metrics) {
    const headers = new Headers();
    for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
    return new Request(url, { method: "POST", headers, body: new Uint8Array(await readBody(req, INGEST_MAX_BYTES)) });
  }
  return toRequest(req, host);
}

async function writeResponse(res: ServerResponse, r: Response) {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(r.status, headers);
  if (!r.body) return void res.end();
  Readable.fromWeb(r.body as import("node:stream/web").ReadableStream).pipe(res);
}

/** A handler that also learns the TCP peer, which the Fetch Request cannot carry. */
export type PeerHandler = (req: Request, remoteAddress: string | undefined) => Promise<Response>;

/**
 * Board's authenticate sees only headers, so the Tailscale login and a bot's channel scope are
 * rewritten here from the TCP peer before Board gets the request (auth.ts explains why). Other
 * routes never read those headers and pass through untouched.
 */
export function withBoardPeer(handler: Handler, auth: Pick<BoardAuthenticate, "prepare"> | null): PeerHandler {
  if (!auth) return (req) => handler(req);
  return (req, remoteAddress) => handler(isBoardPath(new URL(req.url).pathname) ? auth.prepare(req, remoteAddress) : req);
}

/**
 * The Board access of the hub: HUB_BOARD_ADMINS by Tailscale login, each bot by its Board token
 * (only its hash is stored), granted the `<slug>/` channels of the projects it owns. Ownership is
 * read per request, so reassigning a project changes the bot's channels without a restart.
 */
export function boardAccess(deps: {
  admins: readonly string[];
  tokens: Pick<SqliteBoardTokenStore, "botForToken">;
  projects: () => readonly ProjectSummary[];
}): BoardAuthenticate {
  return createBoardAuthenticate({
    admins: deps.admins,
    botForToken: (token) => deps.tokens.botForToken(token),
    projectsOfBot: (bot) => deps.projects().filter((p) => p.ownerBot === bot).map((p) => p.id),
  });
}

export function mount(handler: PeerHandler, host: string, port: number) {
  const server = createServer((req, res) => {
    adaptRequest(req, `${host}:${port}`)
      .then((r) => handler(r, req.socket.remoteAddress))
      .then((r) => writeResponse(res, r))
      .catch((e) => {
        if (res.headersSent || res.destroyed) return;
        const tooLarge = e instanceof BodyTooLarge;
        res.writeHead(tooLarge ? 413 : 500, { "content-type": "application/json", connection: "close" });
        res.end(tooLarge ? '{"error":"payload too large"}' : '{"error":"internal error"}');
      });
  });
  // Node's default 5 min request timeout would cut a 1 GiB upload on a slow tailnet link.
  server.requestTimeout = 60 * 60 * 1000;
  server.listen(port, host);
  return server;
}

const DEFAULT_ENV_FILE = resolve(import.meta.dirname, "../../../.env");

/** process.env plus the hub env file. A missing default file is fine; a missing explicit HUB_ENV_FILE is an error. */
function hubEnv(): Record<string, string | undefined> {
  const explicit = process.env.HUB_ENV_FILE?.trim();
  const file = explicit || DEFAULT_ENV_FILE;
  if (!existsSync(file)) {
    if (explicit) throw new ConfigError("HUB_ENV_FILE does not exist");
    return process.env;
  }
  return withEnvFile(process.env, readFileSync(file, "utf8"));
}

async function main() {
  const env = hubEnv();
  const cfg = loadHubConfig(env, (p) => readFileSync(p, "utf8"));
  const boardCfg = loadBoardConfig(env);
  if (boardCfg && !cfg.dataDir) throw new ConfigError("HUB_BOARD_URL needs HUB_DATA_DIR (the board keeps its SQLite file there)");

  let store: UsageStore = new MemoryUsageStore();
  let projectStore: ProjectStore | null = null;
  let projects: ProjectsApi | null = null;
  // Without HUB_DATA_DIR pushed metrics live in memory and no agent token exists, so ingest answers 401.
  let dbPath = ":memory:";
  if (cfg.dataDir) {
    mkdirSync(cfg.dataDir, { recursive: true });
    dbPath = join(cfg.dataDir, "hub.sqlite");
    const { SqliteUsageStore } = await import("./store-sqlite.ts");
    store = new SqliteUsageStore(dbPath);
    const { ProjectStore } = await import("./projects-store.ts");
    projectStore = new ProjectStore(dbPath);
    const files = new DeliverableFiles(join(cfg.dataDir, "deliverables"));
    await files.init();
    projects = createProjectsApi({ store: projectStore, files, quotaBytes: cfg.deliverablesQuotaBytes });
  }
  const metrics = new SqliteMetricsStore(dbPath);

  // Board lives in this process (no `vb serve`), its file under $HUB_DATA_DIR/board. The events module
  // (watch, onStart) is not plugged in yet, so it runs no watchers.
  let boardService: import("./board/service.ts").BoardService | null = null;
  let boardAuth: BoardAuthenticate | null = null;
  let boardTokens: SqliteBoardTokenStore | null = null;
  if (boardCfg && cfg.dataDir) {
    const { createBoardService, boardDir } = await import("./board/service.ts");
    const { SqliteBoardTokenStore } = await import("./board/tokens.ts");
    // Same file scripts/board-token.ts writes, so issued and revoked tokens apply at the next request.
    boardTokens = new SqliteBoardTokenStore(dbPath);
    boardAuth = boardAccess({ admins: cfg.boardAdmins, tokens: boardTokens, projects: () => projectStore?.listProjects() ?? [] });
    boardService = createBoardService({
      config: boardCfg,
      storage: { dir: boardDir(cfg.dataDir) },
      authenticate: boardAuth,
      catalog: () => projects?.catalog() ?? [],
    });
    await boardService.start();
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
    projects,
    botTokens: cfg.botTokens,
    ingest: createIngestHandler({ store: metrics, knownMachines: new Set(cfg.machines.map((m) => m.id)) }),
    board: boardService,
  });

  const served = withBoardPeer(handler, boardAuth);
  const stop = hub.start();
  const servers = [mount(served, cfg.listenHost, cfg.listenPort)];
  // The admin's Tailscale login is trusted only from loopback, where tailscale serve connects from. The main
  // listener is on the Tailscale IP, which tailscale serve would reach from that IP too, so the admin path
  // needs this listener and `tailscale serve` must point at http://127.0.0.1:<HUB_LISTEN_PORT>.
  const LOOPBACK = "127.0.0.1";
  if (boardAuth && cfg.boardAdmins.length > 0 && cfg.listenHost !== LOOPBACK) servers.push(mount(served, LOOPBACK, cfg.listenPort));
  console.log(
    `fhub listening on ${cfg.listenHost}:${cfg.listenPort}${servers.length > 1 ? ` and ${LOOPBACK}:${cfg.listenPort}` : ""} (machines: ${cfg.machines.length}, auth: ${cfg.apiToken ? "on" : "off"}, bots: ${cfg.botTokens.length}, projects: ${projects ? "on" : "off"}, board: ${boardService ? `on, admins: ${cfg.boardAdmins.length}` : "off"})`,
  );
  const shutdown = () => {
    stop();
    let open = servers.length;
    const closed = () => {
      if (--open > 0) return;
      void (boardService?.stop() ?? Promise.resolve())
        .catch(() => undefined)
        .finally(() => {
          store.close?.();
          projectStore?.close();
          boardTokens?.close();
          metrics.close();
          process.exit(0);
        });
    };
    for (const s of servers) s.close(closed);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (import.meta.main ?? process.argv[1] === import.meta.filename) {
  main().catch((e) => {
    console.error(`fhub failed to start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
