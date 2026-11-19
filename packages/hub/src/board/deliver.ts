/**
 * Sends the outbox to the bots' webhooks. Bounded on every axis so a dead or slow receiver can't hurt the
 * hub: a few deliveries per tick, one at a time, each with a timeout, exponential backoff between
 * attempts and a cap on attempts after which the row is marked dead (kept for the operator). Nothing here
 * throws out of a tick, and the timer is unref'd so it never keeps the process alive.
 *
 * Each request carries:
 *   x-bnet-delivery   the stable delivery id (Board message id:block index); receivers dedupe on it
 *   x-bnet-attempt    1, 2, …
 *   x-bnet-timestamp  unix seconds
 *   x-bnet-signature  sha256=<hex HMAC of "<timestamp>.<body>"> when the bot has a secret
 */
import { createHmac } from "node:crypto";
import type { BoardOutbox, DueDelivery } from "./outbox.ts";

export interface DelivererDeps {
  outbox: Pick<BoardOutbox, "due" | "markDelivered" | "markFailed">;
  fetch: typeof fetch;
  secretFor: (bot: string) => string | null;
  now?: () => number;
  log?: (line: string) => void;
  maxAttempts?: number;
  timeoutMs?: number;
  batch?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface Deliverer {
  /** One pass over what is due. Never rejects. */
  tick(): Promise<void>;
  start(intervalMs?: number): void;
  /** Ask for a pass soon (after an enqueue), without waiting for the timer. */
  kick(): void;
  stop(): void;
}

export const sign = (secret: string, timestamp: number, body: string) => `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

/** Delay before attempt `n + 1` after `n` failures: base·2^(n−1), capped. */
export const backoffMs = (failures: number, base = 5_000, max = 15 * 60_000) => Math.min(max, base * 2 ** Math.max(0, failures - 1));

export function createDeliverer(deps: DelivererDeps): Deliverer {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const maxAttempts = deps.maxAttempts ?? 8;
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const batch = deps.batch ?? 10;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  let again = false;

  async function send(d: DueDelivery): Promise<void> {
    const attempt = d.attempts + 1;
    const ts = Math.floor(now() / 1000);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "b-net-hub",
      "x-bnet-delivery": d.id,
      "x-bnet-attempt": String(attempt),
      "x-bnet-timestamp": String(ts),
    };
    const secret = deps.secretFor(d.bot);
    if (secret) headers["x-bnet-signature"] = sign(secret, ts, d.body);
    let error: string;
    try {
      const res = await deps.fetch(d.url, { method: "POST", headers, body: d.body, signal: AbortSignal.timeout(timeoutMs), redirect: "error" });
      await res.body?.cancel().catch(() => undefined);
      if (res.ok) {
        deps.outbox.markDelivered(d.id, d.bot, new Date(now()));
        return;
      }
      error = `HTTP ${res.status}`;
    } catch (e) {
      // Only the error class: a message could carry the URL, and the URL is config, not log material.
      error = e instanceof Error ? e.name : "error";
    }
    const giveUp = attempt >= maxAttempts;
    deps.outbox.markFailed(d.id, d.bot, error, giveUp ? null : now() + backoffMs(attempt, deps.baseDelayMs, deps.maxDelayMs));
    log(`board webhook ${d.bot} ${d.id}: ${error}${giveUp ? `, gave up after ${attempt} attempts` : `, attempt ${attempt}`}`);
  }

  async function pass(): Promise<void> {
    do {
      again = false;
      try {
        for (const d of deps.outbox.due(now(), batch)) await send(d);
      } catch (e) {
        log(`board webhook pass failed: ${e instanceof Error ? e.name : "error"}`);
      }
    } while (again);
  }

  const tick = () => {
    if (running) {
      again = true;
      return running;
    }
    running = pass().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    tick,
    start(intervalMs = 5_000) {
      if (timer) return;
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
    },
    kick() {
      void tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
