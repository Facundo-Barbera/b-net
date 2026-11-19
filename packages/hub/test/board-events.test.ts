import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BnetWebhookBodySchema } from "@b-net/core";
import { block, board } from "@vercel/board";
import { local } from "@vercel/board/backend-local";
import { backoffMs, createDeliverer, sign } from "../src/board/deliver.ts";
import { deliveriesFor, type EventLike } from "../src/board/events.ts";
import { BoardOutbox } from "../src/board/outbox.ts";
import { createBoardService, type BoardService } from "../src/board/service.ts";
import { eventually, recordingFetch, startService, testConfig } from "./board-helpers.ts";

const AT = "2026-11-15T20:30:00.000Z";
const ev = (over: Record<string, unknown> = {}) => ({ schema: "bnet.event", version: 1, kind: "question", project: "b-net", bot: "fstack-vps", summary: "¿Fusiono?", at: AT, ...over });
const posted = (channel: string, data: Record<string, unknown>[], type = "message.posted"): EventLike => ({
  type,
  message: { id: "12", channel, createdAt: AT, blocks: data.map((d) => ({ schema: "bnet.event", version: 1, data: d })) },
});
const routing = { bots: testConfig().bots, defaultWebhookUrl: "http://127.0.0.1:8799/bnet-webhook" };

describe("which events become webhooks", () => {
  it("a new bnet.event in <slug>/eventos goes to its bot's webhook, with a stable id", () => {
    const [d, ...more] = deliveriesFor(posted("b-net/eventos", [ev()]), routing);
    expect(more).toEqual([]);
    expect(d).toMatchObject({ id: "12:0", bot: "fstack-vps", url: "http://sink.invalid/bnet-webhook" });
    const body = BnetWebhookBodySchema.parse(JSON.parse(d!.body));
    expect(body).toEqual({ id: "12:0", board: { message: "12", channel: "b-net/eventos", at: AT }, event: ev() });
  });

  it("a bot without a webhook of its own gets the local test sink", () => {
    const [d] = deliveriesFor(posted("bixku-bot/eventos", [ev({ project: "bixku-bot", bot: "telegram-bot", kind: "blocked" })]), routing);
    expect(d!.url).toBe("http://127.0.0.1:8799/bnet-webhook");
  });

  it("ignores edits and labels, other channels, other projects, bots outside the project and other kinds", () => {
    const none = [
      posted("b-net/eventos", [ev()], "message.edited"),
      posted("b-net/eventos", [ev()], "labels.changed"),
      posted("b-net/avances", [ev()]),
      posted("b-net/eventos", [ev({ project: "bixku-bot" })]),
      posted("b-net/eventos", [ev({ bot: "telegram-bot" })]),
      // "*" bots publish; they are nobody's project bot.
      posted("b-net/eventos", [ev({ bot: "orquestador" })]),
      posted("b-net/eventos", [ev({ kind: "deployed" })]),
      posted("b-net/eventos", [ev({ version: 2 })]),
    ];
    for (const e of none) expect(deliveriesFor(e, routing), JSON.stringify(e)).toEqual([]);
  });
});

describe("delivery", () => {
  const item = (id: string) => ({ id, bot: "fstack-vps", url: "http://sink.invalid/bnet-webhook", body: '{"x":1}' });

  it("signs, delivers once, and marks the row delivered", async () => {
    const o = new BoardOutbox(":memory:");
    o.enqueue([item("1:0")], new Date(0));
    const rec = recordingFetch(200);
    const d = createDeliverer({ outbox: o, fetch: rec.fetch, secretFor: () => "test-secret-not-real", now: () => 10_000 });
    await d.tick();
    await d.tick();
    expect(rec.sent).toHaveLength(1);
    expect(rec.sent[0]!.headers).toMatchObject({ "x-bnet-delivery": "1:0", "x-bnet-attempt": "1", "x-bnet-timestamp": "10", "x-bnet-signature": sign("test-secret-not-real", 10, '{"x":1}') });
    expect(o.get("1:0", "fstack-vps")!.status).toBe("delivered");
  });

  it("retries with growing backoff, gives up after the cap, and never throws", async () => {
    const o = new BoardOutbox(":memory:");
    o.enqueue([item("2:0")], new Date(0));
    let now = 0;
    const logs: string[] = [];
    const failing = (async () => {
      throw new TypeError("fetch failed: http://sink.invalid/bnet-webhook");
    }) as unknown as typeof fetch;
    const d = createDeliverer({ outbox: o, fetch: failing, secretFor: () => null, now: () => now, maxAttempts: 3, log: (l) => logs.push(l) });
    await d.tick();
    expect(o.get("2:0", "fstack-vps")).toMatchObject({ status: "pending", attempts: 1, lastError: "TypeError" });
    await d.tick(); // not due yet
    expect(o.get("2:0", "fstack-vps")!.attempts).toBe(1);
    now += backoffMs(1);
    await d.tick();
    now += backoffMs(2);
    await d.tick();
    expect(o.get("2:0", "fstack-vps")).toMatchObject({ status: "dead", attempts: 3 });
    // The log names the error class, never the URL.
    expect(logs.join("\n")).not.toContain("sink.invalid");
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(30)).toBe(15 * 60_000);
  });
});

describe("watcher, cursor and restarts on a real board", () => {
  let svc: BoardService | null = null;
  let dir: string | null = null;
  afterEach(async () => {
    await svc?.stop();
    svc = null;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("the watcher records a posted event, and a reconcile pass over the same event adds nothing", async () => {
    let rec;
    ({ svc, rec } = await startService());
    await svc.team.post("b-net/eventos", `¿Fusiono?\n\n${block("bnet.event@1", ev())}`);
    await eventually(() => svc!.outbox.counts().pending + svc!.outbox.counts().delivered === 1);
    expect(await svc.reconcile()).toBe(0);
    await svc.deliverer.tick();
    expect(rec.sent).toHaveLength(1);
    expect(svc.outbox.counts()).toEqual({ pending: 0, delivered: 1, dead: 0 });
  });

  it("after a restart, picks up an event its watcher never saw, and delivers a pending one exactly once", async () => {
    dir = mkdtempSync(join(tmpdir(), "bnet-board-"));
    const dbPath = join(dir, "hub.sqlite");
    const boardDir = join(dir, "board");

    // First run: the receiver is down, so the first event stays pending.
    const down = recordingFetch(503);
    svc = createBoardService({ config: testConfig(), storage: { dir: boardDir }, dbPath, fetch: down.fetch, log: () => undefined });
    await svc.start();
    await svc.team.post("b-net/eventos", `uno\n\n${block("bnet.event@1", ev({ summary: "uno" }))}`);
    await eventually(() => svc!.outbox.counts().pending === 1);
    await svc.deliverer.tick();
    await svc.stop();
    svc = null;

    // While the hub is down, something writes to the board file without the hub's watcher.
    const otherBackend = local({ dir: boardDir });
    const other = board({ backend: otherBackend });
    await other.post("b-net/eventos", `dos\n\n${block("bnet.event@1", ev({ summary: "dos", kind: "thread_done" }))}`);
    await otherBackend.close();

    // Second run: catch-up from the persisted cursor adds only the missed event; the pending one is not duplicated.
    // An hour later, so the first event's backoff has passed.
    const up = recordingFetch(200);
    svc = createBoardService({ config: testConfig(), storage: { dir: boardDir }, dbPath, fetch: up.fetch, log: () => undefined, now: () => Date.now() + 3600_000 });
    await svc.start();
    await svc.deliverer.tick();
    const summaries = up.sent.map((s) => BnetWebhookBodySchema.parse(JSON.parse(s.body)).event.summary).sort();
    expect(summaries).toEqual(["dos", "uno"]);
    expect(svc.outbox.counts()).toEqual({ pending: 0, delivered: 2, dead: 0 });
    expect(await svc.reconcile()).toBe(0);
  });
});
