/**
 * Production entrypoint: mounts the Fetch-API app on node:http.
 *
 *   node packages/proxy/src/serve.ts /etc/bixku-proxy/proxy.json
 *
 * NOT run during development on bixku-vps (no services there). Deployed by
 * Facundo on bixku-homelab, binding only to the Tailscale IP from config.
 * The master key comes from a file (systemd LoadCredential), never env.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createProxyApp } from "./app.ts";
import { ClientAuth } from "./clients.ts";
import { loadConfig } from "./config.ts";
import type { ProxyDeps } from "./deps.ts";
import { AccountPool } from "./pool.ts";
import { createLogger } from "./redact.ts";
import { SecretStore } from "./secrets.ts";
import { SqliteRecordStore } from "./store/sqlite.ts";
import { createUlidFactory, systemClock } from "./util.ts";

export const VERSION = "0.1.0";

function toRequest(req: IncomingMessage, host: string): Request {
  const ac = new AbortController();
  req.on("close", () => {
    if (!req.complete || req.destroyed) ac.abort();
  });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x);
    else headers.set(k, v);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  return new Request(`http://${host}${req.url ?? "/"}`, {
    method,
    headers,
    signal: ac.signal,
    ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: "half" } : {}),
  } as RequestInit);
}

async function writeResponse(res: ServerResponse, r: Response) {
  const headers: Record<string, string> = {};
  r.headers.forEach((v, k) => (headers[k] = v));
  res.writeHead(r.status, headers);
  if (!r.body) return res.end();
  const reader = r.body.getReader();
  res.on("close", () => void reader.cancel().catch(() => {}));
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!res.write(value)) await new Promise((ok) => res.once("drain", ok));
  }
  res.end();
}

export function main(configPath: string) {
  const config = loadConfig(configPath);
  if (config.listen.host === "0.0.0.0" || config.listen.host === "::") throw new Error("refusing to listen on all interfaces; use the Tailscale IP");
  const logger = createLogger();
  const secrets = SecretStore.open(config.secrets.file, config.secrets.masterKeyFile);
  const clock = systemClock;
  const deps: ProxyDeps = {
    config,
    pool: new AccountPool(config.accounts, config.routing, clock),
    store: new SqliteRecordStore(config.records.sqlitePath),
    clients: new ClientAuth(config.clients, secrets.reveal(config.secrets.clientKeyPepperId)),
    credentials: async (a) => secrets.reveal(a.secretId),
    fetch: (input, init) => fetch(input, init),
    clock,
    ids: createUlidFactory(clock),
    logger,
    version: VERSION,
    startedAt: clock.now(),
    adminToken: secrets.reveal(config.secrets.adminTokenId),
    secrets,
  };
  const app = createProxyApp(deps);
  const hostHeader = `${config.listen.host}:${config.listen.port}`;
  const server = createServer((req, res) => {
    app(toRequest(req, hostHeader))
      .then((r) => writeResponse(res, r))
      .catch((err) => {
        logger.log("error", "response write failed", { err });
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  });
  server.listen(config.listen.port, config.listen.host, () => logger.log("info", "bixku-proxy listening", { listen: hostHeader, version: VERSION }));
  const stop = () => server.close(() => (deps.store.close?.(), process.exit(0)));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node serve.ts <config.json>");
    process.exit(2);
  }
  main(path);
}
