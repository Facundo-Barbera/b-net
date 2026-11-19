import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AgentMetricsPush } from "@fhub/core";
import type { Collector } from "./metrics/collector.ts";

/** Sends one POST and resolves with the HTTP status. Rejects on network errors and timeouts. */
export type PostJson = (url: string, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<number>;

/**
 * node:http instead of global fetch: in a micro-benchmark on Linux (Node 22) one fetch POST cost
 * ~20 ms CPU (undici + its wasm HTTP parser load lazily and stay resident), node:http ~2 ms.
 * No keep-alive: one request every 30 s does not justify holding a socket open.
 */
export const postJson: PostJson = (url, headers, body, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = (url.startsWith("https:") ? httpsRequest : httpRequest)(
      url,
      { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, timeout: timeoutMs },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { name: "TimeoutError" })));
    req.on("error", reject);
    req.end(body);
  });

export interface PusherDeps {
  collector: Collector;
  post?: PostJson;
  ingestUrl: string;
  machineId: string;
  /** Never logged or echoed. */
  token: string;
  version: string;
  timeoutMs?: number;
  /** Called only when the push state changes (ok <-> failing), so a dead hub does not flood the journal. */
  log?: (line: string) => void;
}

export type PushOutcome = { ok: true } | { ok: false; reason: string };

/**
 * One sample -> one POST. No retry and no buffering: a missed sample is simply replaced by the
 * next one 30 s later, which keeps memory flat however long the hub is away.
 */
export function createPusher(deps: PusherDeps) {
  let failing: string | null = null;
  const log = deps.log ?? (() => {});
  const post = deps.post ?? postJson;

  async function pushOnce(): Promise<PushOutcome> {
    let outcome: PushOutcome;
    try {
      const body: AgentMetricsPush = { machineId: deps.machineId, agentVersion: deps.version, metrics: await deps.collector.sample() };
      const status = await post(
        deps.ingestUrl,
        { "content-type": "application/json", authorization: `Bearer ${deps.token}` },
        JSON.stringify(body),
        deps.timeoutMs ?? 10_000,
      );
      outcome = status >= 200 && status < 300 ? { ok: true } : { ok: false, reason: `HTTP ${status}` };
    } catch (e) {
      // Error name only (ECONNREFUSED/TimeoutError...): messages could contain the URL, never the token, but stay terse.
      const code = (e as { code?: unknown }).code;
      outcome = { ok: false, reason: typeof code === "string" ? code : e instanceof Error ? e.name : "error" };
    }
    if (outcome.ok && failing !== null) {
      log("push recovered");
      failing = null;
    } else if (!outcome.ok && failing !== outcome.reason) {
      log(`push failing: ${outcome.reason}`);
      failing = outcome.reason;
    }
    return outcome;
  }

  /** Primes the CPU/network deltas so the first pushed sample is a real interval reading, not a since-boot average. */
  async function prime(): Promise<void> {
    await deps.collector.sample().catch(() => undefined);
  }

  return { pushOnce, prime };
}
