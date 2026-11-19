import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { BOARD_PACKAGE_VERSION, snapshotFixture, type BoardProjectsResponse } from "@b-net/core";
import { block } from "@vercel/board";
import { ConfigError } from "../src/config.ts";
import { BOARD_PROJECTS_ROUTE, loadBoardConfig } from "../src/board/config.ts";
import { actorLabel, plainText, prStateOf, workStateOf } from "../src/board/read.ts";
import type { BoardService } from "../src/board/service.ts";
import { createHandler } from "../src/http.ts";
import { MemoryUsageStore } from "../src/store.ts";
import { boardRequest, catalogFixture, eventually, startEngine, testAuthenticate } from "./board-helpers.ts";

describe("board config", () => {
  it("is off without HUB_BOARD_URL and normalizes the mount URL", () => {
    expect(loadBoardConfig({})).toBeNull();
    expect(loadBoardConfig({ HUB_BOARD_URL: "https://bixku-homelab.tail0fake.ts.net/api/board/" })).toEqual({
      url: "https://bixku-homelab.tail0fake.ts.net/api/board",
      publicHost: "bixku-homelab.tail0fake.ts.net",
    });
  });

  it("refuses a plain-http public URL and a wrong mount path", () => {
    expect(() => loadBoardConfig({ HUB_BOARD_URL: "http://hub.example.com/api/board" })).toThrow(ConfigError);
    expect(() => loadBoardConfig({ HUB_BOARD_URL: "https://bixku-homelab.tail0fake.ts.net/board" })).toThrow(/must end with/);
  });

  it("pins @vercel/board to the contract's version", () => {
    // Read at runtime: a JSON import would put package.json in the tsconfig's file list (TS6307).
    const hubPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    expect(hubPackage.dependencies["@vercel/board"]).toBe(BOARD_PACKAGE_VERSION);
  });
});

describe("read helpers", () => {
  it("maps Board task states and PR labels to b-net's words", () => {
    const now = Date.parse("2026-11-15T20:30:00Z");
    expect(workStateOf({ state: "claimed", claim: { actor: "bnet:bot:x", until: "2026-11-15T20:40:00Z" } }, now)).toBe("en_curso");
    // A lease that ran out reads as waiting even before Board's timer fires.
    expect(workStateOf({ state: "claimed", claim: { actor: "bnet:bot:x", until: "2026-11-15T20:00:00Z" } }, now)).toBe("en_espera");
    expect(workStateOf({ state: "ready", claim: null }, now)).toBe("en_espera");
    expect(workStateOf({ state: "failed", claim: null }, now)).toBe("bloqueado");
    expect(workStateOf({ state: "completed", claim: null }, now)).toBe("listo");
    expect(workStateOf({ state: "canceled", claim: null }, now)).toBeNull();
    expect([prStateOf("listo"), prStateOf("fusionado"), prStateOf("cerrado"), prStateOf("en_curso"), prStateOf(undefined)]).toEqual(["fusionado", "fusionado", "cerrado", "abierto", "abierto"]);
  });

  it("names actors for people and strips data fences from excerpts", () => {
    expect(actorLabel("bnet:bot:fstack-vps")).toBe("fstack-vps");
    expect(actorLabel("tailscale:user:facundo@example.invalid")).toBe("facundo");
    expect(actorLabel("bnet:bot:orquestador+claude")).toBe("claude vía orquestador");
    expect(actorLabel("board:client")).toBe("hub");
    expect(plainText('listo\n\n```json#bnet.event@1\n{"v":1}\n```', 100)).toBe("listo");
  });
});

describe("engine on a real local() board", () => {
  let svc: BoardService | null = null;
  afterEach(async () => {
    await svc?.stop();
    svc = null;
  });

  it("denies every caller by default and runs no watchers", async () => {
    ({ svc } = await startEngine());
    expect((await svc.fetch(boardRequest("/me"))).status).toBe(401);
    expect((await svc.fetch(boardRequest("/me", { token: "test-admin" }))).status).toBe(401);
    expect((await svc.fetch(boardRequest("/messages", { token: "anything", body: { channel: "b-net/avances", text: "x" } }))).status).toBe(401);
    // Discovery takes no token and names the configured URL, so clients mint for the right audience.
    const discovery = (await (await svc.fetch(boardRequest("/"))).json()) as { url: string };
    expect(discovery.url).toBe("http://127.0.0.1:8780/api/board");
  });

  it("takes an injected authenticate and injected watchers", async () => {
    const seen: string[] = [];
    ({ svc } = await startEngine({
      authenticate: testAuthenticate,
      watch: { probe: { tail: "b-net/", run: ({ event }) => void (event.type === "message.posted" && seen.push(event.message!.text)) } },
    }));
    const me = await svc.fetch(boardRequest("/me", { token: "test-admin" }));
    expect(me.status).toBe(200);
    expect(((await me.json()) as { principal: string }).principal).toBe("test:user:admin");
    expect((await svc.fetch(boardRequest("/messages", { token: "test-admin", body: { channel: "b-net/avances", text: "hola" } }))).status).toBe(201);
    await eventually(() => seen.includes("hola"));
  });

  it("runs start hooks in order and keeps going when one fails", async () => {
    const order: string[] = [];
    const { svc: s, logs } = await startEngine({
      onStart: [
        async () => void order.push("a"),
        async () => {
          throw new Error("boom");
        },
        async (team) => void order.push((await team.me()).actor),
      ],
    });
    svc = s;
    expect(order).toEqual(["a", "board:client"]);
    expect(logs.join("\n")).toContain("start hook failed (boom)");
  });

  it("persists across a restart on disk", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "bnet-board-"));
    try {
      let s = (await startEngine({ storage: { dir } })).svc;
      await s.team.post("b-net/avances", "antes del reinicio");
      await s.stop();
      s = (await startEngine({ storage: { dir } })).svc;
      const page = await s.team.channel("b-net/avances").messages();
      expect(page.messages.map((m) => m.text)).toEqual(["antes del reinicio"]);
      await s.stop();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("serves the UI model: tasks by WorkState, updates, PRs, events, summaries", async () => {
    ({ svc } = await startEngine({ catalog: () => catalogFixture, ownerOf: (s) => (s === "b-net" ? "fstack-vps" : undefined), knownProjects: () => ["bixku-bot"] }));
    const t = svc.team;
    // Board refuses blocks whose schema it doesn't have; registering it is the events module's job (PR #7).
    await t.createSchema({ name: "bnet.event", version: 1, schema: { type: "object" } });
    await t.tasks.create("b-net/tareas", { text: "Montar Board", labels: { project: "b-net", pr: "Facundo-Barbera/b-net#5", thread: "th_01" } });
    await t.post("b-net/avances", "Tests en verde en la mini: https://github.com/Facundo-Barbera/b-net/pull/5");
    await t.post("b-net/prs", { text: "web: centro de trabajo", labels: { project: "b-net", pr: "Facundo-Barbera/b-net#5", state: "en_curso" } });
    const ev = { schema: "bnet.event", version: 1, kind: "question", project: "b-net", bot: "fstack-vps", summary: "¿Fusiono?", at: "2026-11-15T20:30:00.000Z" };
    await t.post("b-net/eventos", `¿Fusiono?\n\n${block("bnet.event@1", ev)}`);

    const res: BoardProjectsResponse = await svc.projects();
    const p = res.projects.find((x) => x.slug === "b-net")!;
    expect(p.name).toBe("b-net");
    expect(p.bot).toBe("fstack-vps");
    expect(p.tasks.map((x) => [x.title, x.state, x.pr, x.thread])).toEqual([["Montar Board", "en_espera", "Facundo-Barbera/b-net#5", "th_01"]]);
    expect(p.updates[0]).toMatchObject({ author: "hub", link: "https://github.com/Facundo-Barbera/b-net/pull/5" });
    expect(p.prs[0]).toMatchObject({ ref: "Facundo-Barbera/b-net#5", url: "https://github.com/Facundo-Barbera/b-net/pull/5", state: "abierto" });
    expect(p.events).toEqual([ev]);
    expect(p.summaries).toEqual([{ id: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1", title: "Resumen de prueba", at: "2026-11-15T20:00:00.000Z" }]);
    // Known projects show even before anyone wrote there.
    expect(res.projects.map((x) => x.slug)).toContain("bixku-bot");
  });
});

describe("hub handler and the board", () => {
  const base = { snapshot: () => snapshotFixture, store: new MemoryUsageStore() };
  const empty: BoardProjectsResponse = { projects: [], generatedAt: "2026-11-15T20:30:00.000Z" };

  it("forwards every method under /api/board to Board, before the hub's own token check", async () => {
    const seen: string[] = [];
    const handler = createHandler({
      ...base,
      apiToken: "placeholder-api-token",
      board: { fetch: async (r) => (seen.push(`${r.method} ${new URL(r.url).pathname}`), new Response("{}", { status: 200 })), projects: async () => empty },
    });
    expect((await handler(new Request("http://hub.invalid/api/board/me"))).status).toBe(200);
    expect((await handler(new Request("http://hub.invalid/api/board/messages", { method: "POST", body: "{}" }))).status).toBe(200);
    expect(seen).toEqual(["GET /api/board/me", "POST /api/board/messages"]);
  });

  it("serves the read model behind the hub's read auth; 404/503 without a board, 502 when it fails", async () => {
    const withBoard = createHandler({ ...base, board: { fetch: async () => new Response(null), projects: async () => empty } });
    const res = await withBoard(new Request(`http://hub.invalid${BOARD_PROJECTS_ROUTE}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(empty);

    const guarded = createHandler({ ...base, apiToken: "placeholder-api-token", board: { fetch: async () => new Response(null), projects: async () => empty } });
    expect((await guarded(new Request(`http://hub.invalid${BOARD_PROJECTS_ROUTE}`))).status).toBe(401);

    const none = createHandler(base);
    expect((await none(new Request("http://hub.invalid/api/board/me"))).status).toBe(404);
    expect((await none(new Request(`http://hub.invalid${BOARD_PROJECTS_ROUTE}`))).status).toBe(503);

    const failing = createHandler({ ...base, board: { fetch: async () => new Response(null), projects: async () => Promise.reject(new Error("x")) } });
    expect((await failing(new Request(`http://hub.invalid${BOARD_PROJECTS_ROUTE}`))).status).toBe(502);
  });
});
