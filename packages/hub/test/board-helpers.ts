/**
 * A real Board (local(), in memory) behind the hub's service, for tests. Nothing listens on a port and no
 * network is used: webhooks go to a recording fake fetch. Tokens are minted per test, never real.
 */
import { createBoardService, type BoardService } from "../src/board/service.ts";
import type { BoardConfig } from "../src/board/config.ts";

export const BOARD_URL = "http://127.0.0.1:8780/api/board";
export const ADMIN = "facundo@example.invalid";

export function testConfig(over: Partial<BoardConfig> = {}): BoardConfig {
  return {
    url: BOARD_URL,
    publicHost: "127.0.0.1:8780",
    admins: new Set([ADMIN]),
    bots: [
      { name: "fstack-vps", projects: ["b-net"], webhook: { url: "http://sink.invalid/bnet-webhook", secret: "test-secret-not-real" } },
      { name: "orquestador", projects: ["*"], webhook: null },
      { name: "telegram-bot", projects: ["bixku-bot"], webhook: null },
    ],
    servePort: 0,
    defaultWebhookUrl: "http://127.0.0.1:8799/bnet-webhook",
    ...over,
  };
}

export interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function recordingFetch(status = 200) {
  const sent: Sent[] = [];
  const state = { status };
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? "") });
    return new Response(null, { status: state.status });
  }) as typeof globalThis.fetch;
  return { fetch, sent, state };
}

export async function startService(config = testConfig(), status = 200): Promise<{ svc: BoardService; rec: ReturnType<typeof recordingFetch>; logs: string[] }> {
  const rec = recordingFetch(status);
  const logs: string[] = [];
  const svc = createBoardService({ config, storage: { memory: true }, dbPath: ":memory:", fetch: rec.fetch, log: (l) => logs.push(l) });
  await svc.start();
  return { svc, rec, logs };
}

/** A request to the mounted board, as the node adapter hands it over. */
export function boardRequest(path: string, init: { method?: string; token?: string; login?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  // In production only serve.ts sets this header (board/identity.ts); tests stand in for it.
  if (init.login) headers["x-bnet-tailnet-login"] = init.login;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${BOARD_URL}${path}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

/** Board's watchers run on their own lanes: wait until `check` holds (or fail after ~2 s). */
export async function eventually(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}
