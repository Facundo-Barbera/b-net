/**
 * POST /ingest/v1/metrics: one sample pushed by an agent. Auth is the per-machine token
 * (only its hash is stored). Responses carry no detail beyond the error class, and the
 * token is never echoed or logged.
 */
import { AgentMetricsPush, INGEST_MAX_BYTES } from "@b-net/core";
import type { Clock } from "./health.ts";
import type { SqliteMetricsStore } from "./metrics-store.ts";

export interface IngestDeps {
  store: Pick<SqliteMetricsStore, "machineForToken" | "insert">;
  /** Machine ids from machines.json; tokens for other ids are refused. */
  knownMachines: ReadonlySet<string>;
  clock?: Clock;
}

const res = (status: number, error?: string, extra: Record<string, string> = {}) =>
  error
    ? new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } })
    : new Response(null, { status, headers: { "cache-control": "no-store" } });

export function createIngestHandler(deps: IngestDeps): (req: Request) => Promise<Response> {
  const clock = deps.clock ?? (() => new Date());
  return async (req) => {
    if (req.method !== "POST") return res(405, "method not allowed", { allow: "POST" });

    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization")?.trim() ?? "");
    const machineId = m ? deps.store.machineForToken(m[1]!) : null;
    if (!machineId) return res(401, "unauthorized", { "www-authenticate": 'Bearer realm="b-net-ingest"' });

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > INGEST_MAX_BYTES) return res(413, "payload too large");
    const text = await req.text().catch(() => null);
    if (text === null || text.length > INGEST_MAX_BYTES) return res(413, "payload too large");

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return res(400, "invalid json");
    }
    const parsed = AgentMetricsPush.safeParse(raw);
    if (!parsed.success) return res(400, `invalid payload at ${parsed.error.issues[0]?.path.join(".") || "(root)"}`);
    // The token decides which machine this is; the body only has to agree.
    if (parsed.data.machineId !== machineId) return res(403, "machine id does not match token");
    if (!deps.knownMachines.has(machineId)) return res(403, "machine not configured");

    deps.store.insert(machineId, Math.floor(clock().getTime() / 1000), parsed.data.metrics);
    return res(204);
  };
}
