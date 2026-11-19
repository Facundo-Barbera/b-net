import { BNET_EVENT_KINDS, WORK_STATES, boardProjectsFixture, type BoardProjectsResponse } from "@b-net/core";
import { usePolled, type DataMode } from "./useSnapshot.ts";

/**
 * Hub route that serves BoardProjectsResponse (contracts/board.ts). Kept here, not in HubRoutes, so this branch
 * does not edit the same lines of api.ts as the engine's PR; move it there once the engine lands.
 */
export const BOARD_PROJECTS_URL = "/api/v1/board/projects";

const PR_STATES: readonly string[] = ["abierto", "fusionado", "cerrado"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const optStr = (v: unknown) => v === undefined || isStr(v);
const every = (v: unknown, ok: (x: Record<string, unknown>) => boolean) => Array.isArray(v) && v.every((x) => isObj(x) && ok(x));

/**
 * The contract is plain TypeScript (no runtime schema), so the UI checks what it relies on: every enum it maps
 * to a word and a glyph must be a known value, or a view would render a state with no label. A body that fails
 * is treated like a failed request (usePolled keeps the last good value).
 */
export function parseBoardProjects(body: unknown): BoardProjectsResponse {
  const ok =
    isObj(body) &&
    isStr(body.generatedAt) &&
    every(body.projects, (p) =>
      isStr(p.slug) &&
      isStr(p.name) &&
      optStr(p.bot) &&
      every(p.tasks, (t) => isStr(t.id) && isStr(t.title) && (WORK_STATES as readonly unknown[]).includes(t.state) && isStr(t.updatedAt) && optStr(t.claimedBy) && optStr(t.leaseUntil) && optStr(t.pr) && optStr(t.thread)) &&
      every(p.updates, (u) => isStr(u.id) && isStr(u.text) && isStr(u.author) && isStr(u.at) && optStr(u.link)) &&
      every(p.prs, (r) => isStr(r.ref) && isStr(r.title) && isStr(r.url) && PR_STATES.includes(r.state as string) && isStr(r.updatedAt)) &&
      every(p.events, (e) => (BNET_EVENT_KINDS as readonly unknown[]).includes(e.kind) && isStr(e.summary) && isStr(e.bot) && isStr(e.at) && optStr(e.thread) && optStr(e.link)) &&
      every(p.summaries, (s) => isStr(s.id) && isStr(s.title) && isStr(s.at)),
    );
  if (!ok) throw new Error("respuesta del tablero con forma inesperada");
  return body as unknown as BoardProjectsResponse;
}

export interface BoardProjectsState {
  data: BoardProjectsResponse | null;
  /** "fixture" in fixture mode, or in dev when the hub does not serve the board yet (then `error` says why). */
  origin: "hub" | "fixture" | null;
  error: string | null;
  /** The hub answered that it has no board: 404 (hub without the route) or 503 (board not configured). */
  missing: boolean;
}

/** HTTP statuses that mean "this hub runs no board", as opposed to a board that fails. */
const MISSING = new Set(["HTTP 404", "HTTP 503"]);

/**
 * What the views get. The fixture fallback is dev-only on purpose: in a real deploy, example data shown as if it
 * were the board would be a lie, so production says the board is missing or failing instead.
 */
export function resolveBoardState(polled: { data: BoardProjectsResponse | null; error: string | null }, mode: DataMode, dev: boolean): BoardProjectsState {
  if (mode === "fixture") return { data: boardProjectsFixture, origin: "fixture", error: null, missing: false };
  if (polled.data) return { data: polled.data, origin: "hub", error: polled.error, missing: false };
  if (polled.error && dev) return { data: boardProjectsFixture, origin: "fixture", error: polled.error, missing: false };
  return { data: null, origin: null, error: polled.error, missing: polled.error != null && MISSING.has(polled.error) };
}

/** Polls the board read model. Keeps polling after a dev fallback, so real data replaces the fixture as soon as the hub serves it. */
export function useBoardProjects(mode: DataMode, dev: boolean = import.meta.env.DEV, intervalMs = 15_000): BoardProjectsState {
  const polled = usePolled<BoardProjectsResponse>(BOARD_PROJECTS_URL, boardProjectsFixture, mode, intervalMs, parseBoardProjects);
  return resolveBoardState(polled, mode, dev);
}
