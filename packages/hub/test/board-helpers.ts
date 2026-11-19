/**
 * A real Board (local(), in memory) behind the hub's engine, for tests. Nothing listens on a port and no
 * network is used. The fake caller below stands in for the access module (PR #6); it is test-only.
 */
import type { BoardConfig } from "../src/board/config.ts";
import { createBoardService, type BoardService, type BoardServiceDeps } from "../src/board/service.ts";

export const BOARD_URL = "http://127.0.0.1:8780/api/board";
export const testConfig = (): BoardConfig => ({ url: BOARD_URL, publicHost: "127.0.0.1:8780" });

/** Test-only authenticate: `Bearer test-admin` is a person (Board's g1 gives it everything). */
export const testAuthenticate: NonNullable<BoardServiceDeps["authenticate"]> = (request) =>
  request.credential === "test-admin" ? { id: "test:user:admin", kind: "person", handle: "admin" } : null;

export async function startEngine(over: Partial<BoardServiceDeps> = {}): Promise<{ svc: BoardService; logs: string[] }> {
  const logs: string[] = [];
  const svc = createBoardService({ config: testConfig(), storage: { memory: true }, log: (l) => logs.push(l), ...over });
  await svc.start();
  return { svc, logs };
}

/** A request to the mounted board, as the node adapter hands it over. */
export function boardRequest(path: string, init: { token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${BOARD_URL}${path}`, { method: init.body === undefined ? "GET" : "POST", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
}

/** Board runs watchers on their own lanes: wait until `check` holds (or fail after ~2 s). */
export async function eventually(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Test data for the read model: one registered project with one HTML deliverable (all fake). */
export const catalogFixture = [
  {
    project: { id: "b-net", name: "b-net", description: "", grouping: { t3ProjectTitles: [], paths: [], gitRemotes: [] }, ownerBot: null, createdAt: "2026-11-01T00:00:00.000Z", deliverableCount: 1, totalBytes: 10, lastDeliverableAt: "2026-11-15T20:00:00.000Z" },
    deliverables: [
      { id: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1", projectId: "b-net", title: "Resumen de prueba", filename: "resumen.html", kind: "html" as const, mimeType: "text/html; charset=utf-8", sizeBytes: 10, sha256: "a".repeat(64), author: "fake-bot", threadId: null, prUrl: null, createdAt: "2026-11-15T20:00:00.000Z" },
    ],
  },
];
