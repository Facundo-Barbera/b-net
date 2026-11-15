/**
 * Fetch-API handler for all HubRoutes + static UI. `(req: Request) => Promise<Response>`.
 * Read-only: only GET/HEAD. Optional bearer token on /api/*. Secrets: SecretMeta only.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, normalize, sep, extname } from "node:path";
import { HubRoutes, SecretMeta, ThreadState, type HubSnapshot } from "@bixku/core";
import type { UsageStore } from "./store.ts";

export type Handler = (req: Request) => Promise<Response>;
/** Returns file bytes for a path relative to the UI root, or null if missing. */
export type StaticReader = (relPath: string) => Promise<Uint8Array | null>;

export interface HandlerDeps {
  snapshot: () => HubSnapshot;
  store: UsageStore;
  apiToken?: string | null;
  staticFiles?: StaticReader | null;
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS },
  });
const error = (status: number, message: string) => json({ error: message }, status);

const digest = (s: string) => createHash("sha256").update(s).digest();
function tokenOk(header: string | null, expected: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!m) return false;
  return timingSafeEqual(digest(m[1]!.trim()), digest(expected));
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
};

/** fs-backed StaticReader confined to `root` (no traversal, no dotfiles). */
export function fsStaticReader(root: string): StaticReader {
  const base = normalize(root.endsWith(sep) ? root : root + sep);
  return async (rel) => {
    const full = normalize(join(base, rel));
    if (!full.startsWith(base)) return null;
    try {
      return new Uint8Array(await readFile(full));
    } catch {
      return null;
    }
  };
}

function safeRel(pathname: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const parts = p.split("/").filter(Boolean);
  if (parts.some((s) => s === ".." || s.startsWith(".") || s.includes("\\") || s.includes("\0"))) return null;
  return parts.join("/") || "index.html";
}

async function serveStatic(reader: StaticReader, pathname: string, head: boolean): Promise<Response> {
  const rel = safeRel(pathname);
  if (!rel) return error(404, "not found");
  let body = await reader(rel);
  let ext = extname(rel);
  // SPA fallback for extension-less routes (client-side routing).
  if (!body && !ext) {
    body = await reader("index.html");
    ext = ".html";
  }
  if (!body) return error(404, "not found");
  const headers: Record<string, string> = {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300",
    ...SECURITY_HEADERS,
  };
  return new Response(head ? null : (body as Uint8Array<ArrayBuffer>), { status: 200, headers });
}

const machineRe = /^\/api\/v1\/machines\/([a-z0-9-]+)$/;
const ACCOUNT_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export function createHandler(deps: HandlerDeps): Handler {
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const head = req.method === "HEAD";
    if (req.method !== "GET" && !head) return error(405, "method not allowed");

    if (path === "/api" || path.startsWith("/api/")) {
      if (deps.apiToken && !tokenOk(req.headers.get("authorization"), deps.apiToken)) return error(401, "unauthorized");
      const res = route(path, url.searchParams);
      return head ? new Response(null, { status: res.status, headers: res.headers }) : res;
    }
    if (deps.staticFiles) return serveStatic(deps.staticFiles, url.pathname, head);
    return error(404, "not found");
  };

  function route(path: string, q: URLSearchParams): Response {
    switch (path) {
      case HubRoutes.snapshot:
        return json(deps.snapshot());
      case HubRoutes.machines:
        return json({ machines: deps.snapshot().machines });
      case HubRoutes.threads: {
        const machine = q.get("machine");
        const state = q.get("state");
        if (state && !ThreadState.safeParse(state).success) return error(400, "invalid state");
        const threads = deps.snapshot().threads.filter((t) => (!machine || t.machineId === machine) && (!state || t.state === state));
        return json({ threads });
      }
      case HubRoutes.accounts:
        return json({ accounts: deps.snapshot().accounts });
      case HubRoutes.usageRecords: {
        const limitRaw = q.get("limit");
        const limit = limitRaw === null ? 100 : Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1) return error(400, "invalid limit");
        const since = q.get("since");
        const account = q.get("account");
        if (since && !ACCOUNT_RE.test(since)) return error(400, "invalid since");
        if (account && !ACCOUNT_RE.test(account)) return error(400, "invalid account");
        return json(deps.store.list({ since, accountId: account, limit }));
      }
      case HubRoutes.proxyStatus: {
        const p = deps.snapshot().proxy;
        return p ? json(p) : error(503, "proxy status unavailable");
      }
      case HubRoutes.secrets:
        // Defense in depth: re-validate with the strict schema; anything else is dropped.
        return json({ secrets: deps.snapshot().secrets.filter((s) => SecretMeta.safeParse(s).success) });
      case HubRoutes.health:
        return json({ ok: true, sources: deps.snapshot().sources });
    }
    const m = machineRe.exec(path);
    if (m) {
      const machine = deps.snapshot().machines.find((x) => x.id === m[1]);
      return machine ? json(machine) : error(404, "machine not found");
    }
    return error(404, "not found");
  }
}
