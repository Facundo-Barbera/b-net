import { afterEach, describe, expect, it } from "vitest";
import { BoardWork } from "@b-net/core";
import { block } from "@vercel/board";
import { ConfigError } from "../src/config.ts";
import { loadBoardConfig } from "../src/board/config.ts";
import { desiredCan } from "../src/board/grants.ts";
import { BoardOutbox } from "../src/board/outbox.ts";
import { actorLabel, plainText } from "../src/board/read.ts";
import type { BoardService } from "../src/board/service.ts";
import { startService } from "./board-helpers.ts";

const files: Record<string, string> = {
  "/etc/b-net/board.json": JSON.stringify({
    admins: ["Facundo@example.invalid"],
    bots: { "fstack-vps": { projects: ["b-net"], webhook: { url: "http://127.0.0.1:8799/bnet-webhook", secretFile: "/etc/b-net/hook" } }, orquestador: { projects: ["*"] } },
  }),
  "/etc/b-net/hook": "placeholder-secret\n",
};
const read = (p: string) => {
  if (!(p in files)) throw new Error("ENOENT");
  return files[p]!;
};
const env = (over: Record<string, string> = {}) => ({ HUB_BOARD_URL: "https://bixku-homelab.tail0fake.ts.net/api/board", HUB_BOARD_CONFIG_FILE: "/etc/b-net/board.json", ...over });

describe("board config", () => {
  it("is off without HUB_BOARD_URL", () => {
    expect(loadBoardConfig({}, read)).toBeNull();
  });

  it("reads admins (lowercased), bots, secrets by file, and the defaults", () => {
    const c = loadBoardConfig(env(), read)!;
    expect(c.url).toBe("https://bixku-homelab.tail0fake.ts.net/api/board");
    expect(c.publicHost).toBe("bixku-homelab.tail0fake.ts.net");
    expect([...c.admins]).toEqual(["facundo@example.invalid"]);
    expect(c.bots.find((b) => b.name === "fstack-vps")!.webhook).toEqual({ url: "http://127.0.0.1:8799/bnet-webhook", secret: "placeholder-secret" });
    expect(c.bots.find((b) => b.name === "orquestador")!.webhook).toBeNull();
    expect(c.servePort).toBe(8779);
    expect(c.defaultWebhookUrl).toBe("http://127.0.0.1:8799/bnet-webhook");
  });

  it("refuses a plain-http public URL, a wrong mount path, bad bot names and credentials in webhook URLs", () => {
    expect(() => loadBoardConfig(env({ HUB_BOARD_URL: "http://hub.example.com/api/board" }), read)).toThrow(ConfigError);
    expect(() => loadBoardConfig(env({ HUB_BOARD_URL: "https://bixku-homelab.tail0fake.ts.net/board" }), read)).toThrow(/must end with/);
    files["/tmp/bad.json"] = JSON.stringify({ bots: { "Bad Bot": { projects: ["b-net"] } } });
    expect(() => loadBoardConfig(env({ HUB_BOARD_CONFIG_FILE: "/tmp/bad.json" }), read)).toThrow(/bots/);
    files["/tmp/cred.json"] = JSON.stringify({ bots: { x: { projects: ["b-net"], webhook: { url: "http://user:pw@127.0.0.1/h" } } } });
    expect(() => loadBoardConfig(env({ HUB_BOARD_CONFIG_FILE: "/tmp/cred.json" }), read)).toThrow(/webhook/);
  });
});

describe("bot grants", () => {
  it("close * and open each project's subtree; '*' bots read and post everywhere", () => {
    expect(desiredCan(["b-net", "homelab-ops"])).toEqual({ "*": "none", "b-net/": ["read", "post", "react", "label"], "homelab-ops/": ["read", "post", "react", "label"] });
    expect(desiredCan(["*"])).toEqual({ "*": ["read", "post", "react", "label"] });
  });
});

describe("outbox and cursor", () => {
  it("inserts each delivery once, advances the cursor with what it recorded, and backs off failures", () => {
    const o = new BoardOutbox(":memory:");
    const item = { id: "12:0", bot: "fstack-vps", url: "http://sink.invalid/h", body: "{}" };
    expect(o.enqueueAndAdvance([item], "c", "100", new Date(0))).toBe(1);
    expect(o.enqueueAndAdvance([item], "c", "101", new Date(0))).toBe(0);
    expect(o.cursor("c")).toBe("101");
    expect(o.due(0)).toHaveLength(1);
    o.markFailed("12:0", "fstack-vps", "HTTP 503", 5_000);
    expect(o.due(1_000)).toHaveLength(0);
    expect(o.due(5_000)[0]!.attempts).toBe(1);
    o.markFailed("12:0", "fstack-vps", "HTTP 503", null);
    expect(o.get("12:0", "fstack-vps")).toEqual({ status: "dead", attempts: 2, lastError: "HTTP 503" });
    o.close();
  });
});

describe("read helpers", () => {
  it("names actors for people and strips data fences from excerpts", () => {
    expect(actorLabel("bnet:bot:fstack-vps")).toBe("fstack-vps");
    expect(actorLabel("tailscale:user:facundo@example.invalid")).toBe("facundo");
    expect(actorLabel("bnet:bot:orquestador+claude")).toBe("claude vía orquestador");
    expect(actorLabel("board:client")).toBe("hub");
    expect(plainText('listo\n\n```json#bnet.event@1\n{"v":1}\n```', 100)).toBe("listo");
  });
});

describe("board service on a real local() board", () => {
  let svc: BoardService | null = null;
  afterEach(async () => {
    await svc?.stop();
    svc = null;
  });

  it("registers bnet.event@1 and gives each configured bot its grant", async () => {
    ({ svc } = await startService());
    expect((await svc.team.schema("bnet.event@1")).version).toBe(1);
    const grants = await svc.team.grants();
    const fstack = grants.find((g) => g.principals.some((p) => p.kind === "user" && p.userId === "fstack-vps"))!;
    expect(fstack.can).toEqual({ "*": [], "b-net/": ["read", "post", "react", "label"] });
    // Starting again changes nothing (idempotent grants and schema).
    await svc.start();
    expect((await svc.team.grants()).filter((g) => g.principals.some((p) => p.kind === "user" && p.userId === "fstack-vps"))).toHaveLength(1);
  });

  it("refuses a bnet.event block that does not match the schema", async () => {
    ({ svc } = await startService());
    await expect(svc.team.post("b-net/events", block("bnet.event@1", { v: 1, kind: "nope" }))).rejects.toMatchObject({ code: "invalid_block" });
  });

  it("serves the UI model: tasks by state, PRs by label, events", async () => {
    ({ svc } = await startService());
    const t = svc.team;
    await t.tasks.create("b-net/work", { text: "Montar Board", labels: { pr: "Facundo-Barbera/b-net#5", state: "doing" } });
    await t.post("b-net/prs", { text: "web: centro de trabajo", labels: { project: "b-net", pr: "Facundo-Barbera/b-net#5", state: "open" } });
    await t.post("b-net/events", `¿Fusiono?\n\n${block("bnet.event@1", { v: 1, kind: "question", project: "b-net", thread: "th_01", summary: "¿Fusiono?", link: null })}`);
    const work = BoardWork.parse(await svc.work());
    expect(work.state).toBe("ok");
    const p = work.projects.find((x) => x.project === "b-net")!;
    expect(p.tasks.map((x) => [x.title, x.state, x.pr])).toEqual([["Montar Board", "ready", "Facundo-Barbera/b-net#5"]]);
    expect(p.prs[0]).toMatchObject({ ref: "Facundo-Barbera/b-net#5", url: "https://github.com/Facundo-Barbera/b-net/pull/5", state: "open" });
    expect(p.events[0]!.event.kind).toBe("question");
    // Projects configured for bots show even before anyone wrote there.
    expect(work.projects.map((x) => x.project)).toContain("bixku-bot");
  });
});
