/**
 * Board inside the hub: one `board()` on `local()` (SQLite under $HUB_DATA_DIR/board), mounted at
 * /api/board, with b-net's own `authenticate` and one watcher. Nothing else runs: no `vb serve`, no
 * inspector, no sync, no agents. The inspector is only for debugging, from another machine
 * (`vb inspect` with BOARD_URL and a bot token).
 *
 * Event flow for bot webhooks, built to survive restarts without losing or duplicating:
 *   1. the watcher `bnet-events` (tail `--text bnet.event@1`) turns each new message's bnet.event@1
 *      blocks into outbox rows at once (INSERT OR IGNORE: idempotent);
 *   2. a reconciler reads the same feed sequentially from a persisted cursor, at boot and then every
 *      minute, inserting idempotently and advancing the cursor in the same transaction, so whatever the
 *      watcher missed (a crash between Board's commit and the watcher's run, a retry a restart dropped)
 *      is picked up and nothing is read twice into the outbox;
 *   3. the deliverer POSTs pending rows with bounded retries and backoff.
 */
import { join } from "node:path";
import { BNET_EVENT_JSON_SCHEMA, BNET_EVENT_SCHEMA, BNET_EVENT_VERSION, BOARD_BASE_PATH, type BoardProjectsResponse, type ProjectCatalogEntry } from "@b-net/core";
import { board, type Board } from "@vercel/board";
import { local, type LocalBackend } from "@vercel/board/backend-local";
import { createAuthenticate } from "./auth.ts";
import type { BoardConfig } from "./config.ts";
import { createDeliverer, type Deliverer } from "./deliver.ts";
import { BNET_EVENT_TEXT, deliveriesFor, type EventLike, type Routing } from "./events.ts";
import { syncBotGrants } from "./grants.ts";
import { BoardOutbox } from "./outbox.ts";
import { readBoardProjects } from "./read.ts";
import { BoardTokenStore } from "./tokens.ts";

export const CURSOR_NAME = "bnet-events";
const RECONCILE_MS = 60_000;
const READ_CACHE_MS = 10_000;
const PRUNE_AFTER_MS = 14 * 24 * 3600_000;

export interface BoardServiceDeps {
  config: BoardConfig;
  /** Where Board keeps its SQLite file and attachments; `{ memory: true }` in tests. */
  storage: { dir: string } | { memory: true };
  /** The hub's hub.sqlite (tokens, outbox, cursor); ":memory:" in tests. */
  dbPath: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  now?: () => number;
  /** Projects and deliverables the hub stores, for names and HTML summaries; none without HUB_DATA_DIR. */
  catalog?: () => readonly ProjectCatalogEntry[];
}

export interface BoardService {
  /** Board's HTTP handler, for everything under /api/board. */
  fetch(request: Request): Promise<Response>;
  /** The hub's own handle (Board's own code: full access). Server side only. */
  team: Board;
  /** Registers the schema, syncs bot grants, catches up from the cursor, starts the timers. */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** GET /api/v1/board/projects, cached briefly so a polling UI costs a few reads every 10 s at most. */
  projects(): Promise<BoardProjectsResponse>;
  /** One sequential pass from the cursor to the head (exported for tests). */
  reconcile(): Promise<number>;
  tokens: BoardTokenStore;
  outbox: BoardOutbox;
  deliverer: Deliverer;
}

export function createBoardService(deps: BoardServiceDeps): BoardService {
  const { config } = deps;
  const log = deps.log ?? ((l: string) => console.error(l));
  const now = deps.now ?? Date.now;
  const tokens = new BoardTokenStore(deps.dbPath);
  const outbox = new BoardOutbox(deps.dbPath);
  const routing: Routing = { bots: config.bots, defaultWebhookUrl: config.defaultWebhookUrl };
  const configured = new Set(config.bots.map((b) => b.name));
  let ready = new Set<string>();
  const secrets = new Map(config.bots.map((b) => [b.name, b.webhook?.secret ?? null]));

  const deliverer = createDeliverer({ outbox, fetch: deps.fetch ?? globalThis.fetch, secretFor: (b) => secrets.get(b) ?? null, now, log });

  const backend: LocalBackend = "memory" in deps.storage ? local({ memory: true }) : local({ dir: deps.storage.dir });

  const record = (event: EventLike) => {
    if (outbox.enqueue(deliveriesFor(event, routing), new Date(now())) > 0) deliverer.kick();
  };

  const team = board({
    backend,
    url: config.url,
    basePath: BOARD_BASE_PATH,
    authenticate: createAuthenticate({
      admins: config.admins,
      botForToken: (t) => tokens.botForToken(t),
      isBotReady: (b) => configured.has(b) && ready.has(b),
      channelsOf: (b) => (config.bots.find((x) => x.name === b)?.projects ?? []).map((p) => (p === "*" ? "*" : `${p}/`)),
    }),
    watch: {
      "bnet-events": {
        tail: `--text ${BNET_EVENT_TEXT}`,
        run: ({ event }) => record(event as EventLike),
      },
    },
  });

  let reconciling: Promise<number> | null = null;
  async function reconcileOnce(): Promise<number> {
    let cursor = outbox.cursor(CURSOR_NAME);
    if (cursor === null) {
      // First boot: start at the head. Nothing before b-net's first run was meant for its webhooks.
      const head = await team.poll({ text: BNET_EVENT_TEXT, last: 1 });
      outbox.enqueueAndAdvance([], CURSOR_NAME, head.cursor, new Date(now()));
      return 0;
    }
    let added = 0;
    for (let pages = 0; pages < 100; pages++) {
      const page = await team.poll({ after: cursor, text: BNET_EVENT_TEXT, wait: 0 });
      const items = page.events.flatMap((e) => deliveriesFor(e as EventLike, routing));
      added += outbox.enqueueAndAdvance(items, CURSOR_NAME, page.cursor, new Date(now()));
      if (page.events.length === 0 || page.cursor === cursor) break;
      cursor = page.cursor;
    }
    if (added > 0) deliverer.kick();
    return added;
  }
  const reconcile = () => (reconciling ??= reconcileOnce().finally(() => (reconciling = null)));

  let timer: ReturnType<typeof setInterval> | null = null;
  let cache: { at: number; value: BoardProjectsResponse } | null = null;

  return {
    fetch: (request) => team.fetch(request),
    team,
    tokens,
    outbox,
    deliverer,
    reconcile,
    async start() {
      const why = (e: unknown) => (e instanceof Error ? e.message.slice(0, 160) : "error");
      // Each step on its own: a failure is logged and the rest still runs, so the hub keeps serving.
      try {
        await team.createSchema({ name: BNET_EVENT_SCHEMA, version: BNET_EVENT_VERSION, description: "Lo que un bot de b-net debe saber: un hilo terminó, hay una pregunta o algo está bloqueado.", schema: { ...BNET_EVENT_JSON_SCHEMA } });
      } catch (e) {
        log(`board: could not register ${BNET_EVENT_TEXT} (${why(e)}); posts carrying it will fail until it is`);
      }
      try {
        const grants = await syncBotGrants(team, config.bots);
        ready = grants.ready;
        for (const f of grants.failed) log(`board: bot ${f.bot} stays locked out, its grant could not be written (${f.error})`);
      } catch (e) {
        log(`board: could not read grants (${why(e)}); every bot stays locked out`);
      }
      for (const b of config.bots) if (b.webhook && !b.webhook.secret) log(`board: bot ${b.name} has a webhook without a secret; its requests go unsigned`);
      try {
        const n = await reconcile();
        if (n > 0) log(`board: caught up ${n} pending webhook deliveries`);
      } catch (e) {
        log(`board: catch-up failed (${why(e)}); retrying every minute`);
      }
      deliverer.start();
      if (timer) return;
      timer = setInterval(() => {
        reconcile().catch((e) => log(`board: reconcile failed (${e instanceof Error ? e.message.slice(0, 120) : "error"})`));
        outbox.prune(now() - PRUNE_AFTER_MS);
      }, RECONCILE_MS);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      deliverer.stop();
      await backend.close();
      tokens.close();
      outbox.close();
    },
    async projects() {
      const t = now();
      if (cache && t - cache.at < READ_CACHE_MS) return cache.value;
      // A failed read throws: the HTTP layer answers 502 and the UI keeps its last good copy.
      const value = await readBoardProjects(team, { catalog: deps.catalog ?? (() => []), bots: config.bots }, new Date(t));
      cache = { at: t, value };
      return value;
    },
  };
}

/** Board storage under the hub's data dir. */
export const boardDir = (dataDir: string) => join(dataDir, "board");
