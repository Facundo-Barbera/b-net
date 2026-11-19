/**
 * The Board engine inside the hub: one `board()` on `local()` (SQLite under $HUB_DATA_DIR/board, so it
 * survives restarts), mounted at /api/board. No `vb serve`, no inspector, no sync, nothing that runs
 * agents: the inspector is for debugging from another machine (`vb inspect` with BOARD_URL).
 *
 * The engine decides neither who may call nor what reacts to events. Both are injected:
 * - `authenticate`: the access module (bot tokens, the Tailscale admin). Default: deny every request.
 * - `watch`: the events module's watchers (bnet.event -> webhooks). Default: none.
 * - `onStart`: work those modules need once the board is up (grants, schema registration, catch-up),
 *   run in order; a failing hook is logged and the hub keeps serving.
 */
import { join } from "node:path";
import { BOARD_BASE_PATH, type BoardProjectsResponse, type ProjectCatalogEntry } from "@b-net/core";
import { board, HttpError, type Board, type BoardOptions, type Watcher } from "@vercel/board";
import { local, type LocalBackend } from "@vercel/board/backend-local";
import type { BoardConfig } from "./config.ts";
import { readBoardProjects, type ReadDeps } from "./read.ts";

const READ_CACHE_MS = 10_000;

export type BoardAuthenticate = NonNullable<BoardOptions["authenticate"]>;

/** The safe default: no caller is anyone until the access module is plugged in. */
export const denyAll: BoardAuthenticate = () => {
  throw new HttpError(401, "unauthorized", "this board takes no callers yet: the hub runs it without an access module");
};

export interface BoardServiceDeps {
  config: BoardConfig;
  /** Where Board keeps its SQLite file and attachments; `{ memory: true }` in tests. */
  storage: { dir: string } | { memory: true };
  authenticate?: BoardAuthenticate;
  watch?: Record<string, Watcher>;
  onStart?: ReadonlyArray<(team: Board) => Promise<void>>;
  /** Projects and deliverables the hub stores, for names and HTML summaries; none without HUB_DATA_DIR. */
  catalog?: () => readonly ProjectCatalogEntry[];
  ownerOf?: ReadDeps["ownerOf"];
  knownProjects?: ReadDeps["knownProjects"];
  log?: (line: string) => void;
  now?: () => number;
}

export interface BoardService {
  /** Board's HTTP handler, for everything under /api/board. */
  fetch(request: Request): Promise<Response>;
  /** The hub's own handle (Board's own code: full access). Server side only, never handed to a browser. */
  team: Board;
  /** Runs the injected start hooks. Never rejects. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** GET /api/v1/board/projects, cached briefly so a polling UI costs a few reads every 10 s at most. */
  projects(): Promise<BoardProjectsResponse>;
}

export function createBoardService(deps: BoardServiceDeps): BoardService {
  const log = deps.log ?? ((l: string) => console.error(l));
  const now = deps.now ?? Date.now;
  const backend: LocalBackend = "memory" in deps.storage ? local({ memory: true }) : local({ dir: deps.storage.dir });
  const team = board({
    backend,
    url: deps.config.url,
    basePath: BOARD_BASE_PATH,
    authenticate: deps.authenticate ?? denyAll,
    watch: deps.watch ?? {},
  });
  const read: ReadDeps = {
    catalog: deps.catalog ?? (() => []),
    ownerOf: deps.ownerOf ?? (() => undefined),
    knownProjects: deps.knownProjects ?? (() => []),
  };
  let cache: { at: number; value: BoardProjectsResponse } | null = null;

  return {
    fetch: (request) => team.fetch(request),
    team,
    async start() {
      for (const hook of deps.onStart ?? []) {
        try {
          await hook(team);
        } catch (e) {
          log(`board: a start hook failed (${e instanceof Error ? e.message.slice(0, 160) : "error"}); the hub keeps serving`);
        }
      }
    },
    async stop() {
      await backend.close();
    },
    async projects() {
      const t = now();
      if (cache && t - cache.at < READ_CACHE_MS) return cache.value;
      // A failed read throws: the HTTP layer answers 502 and the UI keeps its last good copy.
      const value = await readBoardProjects(team, read, new Date(t));
      cache = { at: t, value };
      return value;
    },
  };
}

/** Board storage under the hub's data dir. */
export const boardDir = (dataDir: string) => join(dataDir, "board");
