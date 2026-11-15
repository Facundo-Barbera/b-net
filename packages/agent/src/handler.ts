import { createHash, timingSafeEqual } from "node:crypto";
import { AgentRoutes, type AgentHealth, type AgentMetrics, type AgentThreads } from "@bixku/core";
import type { T3ReadResult } from "@bixku/core/clients/t3";
import type { MetricsSnapshot } from "./sampler.ts";

export interface AgentHandlerDeps {
  machineId: string;
  /** Expected bearer token. Never logged or echoed. */
  token: string;
  version: string;
  startedAt: Date;
  getMetrics(): Promise<MetricsSnapshot>;
  readThreads(): T3ReadResult | Promise<T3ReadResult>;
}

/** Constant-time string comparison (hashes first so length differences leak nothing). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = h ? /^Bearer\s+(\S+)$/i.exec(h.trim()) : null;
  return m ? m[1]! : null;
}

/**
 * Fetch-API handler for AgentRoutes. Every route (health included) requires the bearer token.
 * Fails closed: constructing it with an empty token throws.
 */
export function createAgentHandler(deps: AgentHandlerDeps): (req: Request) => Promise<Response> {
  if (!deps.token) throw new Error("agent token must not be empty");

  return async (req) => {
    const path = new URL(req.url).pathname;
    const known = Object.values(AgentRoutes) as string[];

    const presented = bearer(req);
    // Compare even when absent so timing does not reveal whether a header was sent.
    const authorized = safeEqual(presented ?? "", deps.token) && presented !== null;
    if (!authorized) {
      return json({ error: "unauthorized" }, 401, { "www-authenticate": 'Bearer realm="bixku-agent"' });
    }
    if (!known.includes(path)) return json({ error: "not_found" }, 404);
    if (req.method !== "GET" && req.method !== "HEAD") return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" });

    try {
      let body: unknown;
      switch (path) {
        case AgentRoutes.health: {
          const t3 = await deps.readThreads();
          const health: AgentHealth = {
            machineId: deps.machineId,
            version: deps.version,
            startedAt: deps.startedAt.toISOString(),
            t3Available: t3.health.ok,
          };
          body = health;
          break;
        }
        case AgentRoutes.metrics: {
          const snap = await deps.getMetrics();
          const out: AgentMetrics = {
            machineId: deps.machineId,
            at: snap.at.toISOString(),
            metrics: snap.metrics,
            history: snap.history,
          };
          body = out;
          break;
        }
        default: {
          const t3 = await deps.readThreads();
          const out: AgentThreads = { threads: t3.threads.map((t) => ({ ...t, machineId: deps.machineId })) };
          body = out;
        }
      }
      return req.method === "HEAD" ? new Response(null, { status: 200, headers: { "cache-control": "no-store" } }) : json(body);
    } catch {
      // No internal detail in the response; the caller (serve.ts) logs nothing sensitive either.
      return json({ error: "internal_error" }, 500);
    }
  };
}
