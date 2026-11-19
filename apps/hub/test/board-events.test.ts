import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { FhubEventV1 } from "@fhub/core";
import { ConfigError } from "../src/config.ts";
import {
  DEFAULT_TEST_WEBHOOK_URL,
  FileSentLog,
  MemorySentLog,
  backoffMs,
  fhubEventFromMessage,
  createFhubWatchers,
  deliverWebhook,
  loadWebhookConfig,
  watcherId,
  type FhubWatchersOptions,
  type BoardEventLike,
  type Logger,
  type WebhookConfig,
} from "../src/board/events.ts";

const ev = (over: Partial<FhubEventV1> = {}): FhubEventV1 => ({
  schema: "bnet.event",
  version: 1,
  kind: "thread_done",
  project: "demo",
  bot: "demo-bot",
  thread: "t-1",
  summary: "Terminó el hilo de prueba.",
  link: "https://example.invalid/pr/1",
  at: "2026-11-19T10:00:00.000Z",
  ...over,
});

const posted = (id: string, data: unknown, over: Partial<BoardEventLike> = {}): BoardEventLike => ({
  cursor: id,
  type: "message.posted",
  message: { id, channel: "demo/eventos", blocks: [{ schema: "bnet.event", version: 1, data: data as Record<string, unknown> }] },
  ...over,
});

const silent = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  return { lines, info: (m) => lines.push(`info ${m}`), warn: (m) => lines.push(`warn ${m}`), error: (m) => lines.push(`error ${m}`) };
};

const ok = () => new Response("ok", { status: 200 });
const noSleep = async () => {};
const webhooks: WebhookConfig = { default: { url: DEFAULT_TEST_WEBHOOK_URL }, bots: {} };

function setup(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, over: Partial<FhubWatchersOptions> = {}) {
  const fetch = vi.fn(fetchImpl);
  const log = silent();
  const sentLog = new MemorySentLog();
  const watchers = createFhubWatchers({
    projects: ["demo"],
    webhooks,
    sentLog,
    fetch: fetch as unknown as typeof globalThis.fetch,
    sleep: noSleep,
    log,
    ...over,
  });
  const run = (e: BoardEventLike) => watchers[watcherId("demo")]!.run({ event: e });
  return { fetch, log, sentLog, watchers, run };
}

describe("fhubEventFromMessage", () => {
  it("takes the first valid bnet.event@1 block", () => {
    const m = { id: "1", channel: "demo/eventos", blocks: [{ schema: "other", version: 1, data: {} }, { schema: "bnet.event", version: 1, data: ev() as unknown as Record<string, unknown> }] };
    expect(fhubEventFromMessage(m)).toEqual(ev());
  });

  it("rejects wrong version, unknown kind, bad link scheme and missing fields", () => {
    const block = (data: unknown, version = 1) => ({ id: "1", channel: "demo/eventos", blocks: [{ schema: "bnet.event", version, data: data as Record<string, unknown> }] });
    expect(fhubEventFromMessage(block(ev(), 2))).toBeNull();
    expect(fhubEventFromMessage(block({ ...ev(), kind: "otro" }))).toBeNull();
    expect(fhubEventFromMessage(block({ ...ev(), link: "javascript:alert(1)" }))).toBeNull();
    const { summary: _s, ...noSummary } = ev();
    expect(fhubEventFromMessage(block(noSummary))).toBeNull();
    expect(fhubEventFromMessage({ id: "1", channel: "demo/eventos" })).toBeNull();
  });
});

describe("createFhubWatchers", () => {
  it("makes one watcher per valid project, tailing <slug>/eventos", () => {
    const log = silent();
    const w = createFhubWatchers({ projects: ["demo", "demo", "Bad Slug", "otro"], webhooks, sentLog: new MemorySentLog(), log });
    expect(Object.keys(w).sort()).toEqual([watcherId("demo"), watcherId("otro")].sort());
    expect(w[watcherId("demo")]!.tail).toBe("demo/eventos");
    expect(log.lines.some((l) => l.startsWith("warn"))).toBe(true);
  });

  it("watcher ids fit Board's profile-name rules, even for long slugs", () => {
    const long = "a".repeat(40) + "-proyecto";
    for (const slug of ["demo", long, "x-".repeat(30) + "y"]) {
      expect(watcherId(slug)).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    }
    expect(watcherId(long)).not.toBe(watcherId(long + "2"));
  });

  it("POSTs the event JSON to the bot's webhook with delivery headers and HMAC", async () => {
    const secret = "test-secret-not-real";
    const { fetch, run } = setup(async () => ok(), {
      webhooks: { default: { url: DEFAULT_TEST_WEBHOOK_URL }, bots: { "demo-bot": { url: "https://hooks.example.invalid/demo", secret } } },
    });
    await run(posted("7", ev()));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://hooks.example.invalid/demo");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(ev());
    const h = init.headers as Record<string, string>;
    expect(h["content-type"]).toBe("application/json");
    expect(h["x-bnet-event"]).toBe("thread_done");
    expect(h["x-bnet-delivery"]).toMatch(/^7:[0-9a-f]{16}$/);
    expect(h["x-bnet-signature"]).toBe(`sha256=${createHmac("sha256", secret).update(init.body as string).digest("hex")}`);
  });

  it("falls back to the default (local test) webhook for bots without an entry", async () => {
    const { fetch, run } = setup(async () => ok());
    await run(posted("1", ev({ bot: "otro-bot" })));
    expect(fetch.mock.calls[0]![0]).toBe(DEFAULT_TEST_WEBHOOK_URL);
  });

  it("ignores edits, reactions, deleted messages, other channels and invalid payloads", async () => {
    const { fetch, run } = setup(async () => ok());
    await run(posted("1", ev(), { type: "message.edited" }));
    await run(posted("2", ev(), { type: "labels.changed" }));
    await run({ cursor: "3", type: "message.posted" });
    await run({ ...posted("4", ev()), message: { ...posted("4", ev()).message!, deleted: true } });
    await run({ ...posted("5", ev()), message: { ...posted("5", ev()).message!, channel: "demo/avances" } });
    await run(posted("6", { ...ev(), kind: "nope" }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops events whose project or bot don't match the channel's project", async () => {
    const { fetch, run, log } = setup(async () => ok(), { ownerOf: (p: string) => (p === "demo" ? "demo-bot" : null) });
    await run(posted("1", ev({ project: "otro" })));
    await run(posted("2", ev({ bot: "intruso" })));
    expect(fetch).not.toHaveBeenCalled();
    expect(log.lines.filter((l) => l.startsWith("warn"))).toHaveLength(2);
  });

  it("does not send the same message twice, also across a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bnet-sent-"));
    const path = join(dir, "sent.json");
    const fetch = vi.fn(async () => ok());
    const make = () =>
      createFhubWatchers({ projects: ["demo"], webhooks, sentLog: new FileSentLog(path), fetch: fetch as unknown as typeof globalThis.fetch, sleep: noSleep, log: silent() });
    const first = make();
    await first[watcherId("demo")]!.run({ event: posted("9", ev()) });
    await first[watcherId("demo")]!.run({ event: posted("9", ev()) });
    expect(fetch).toHaveBeenCalledTimes(1);
    // "Reinicio": watchers y log nuevos sobre el mismo archivo.
    const second = make();
    await second[watcherId("demo")]!.run({ event: posted("9", ev()) });
    expect(fetch).toHaveBeenCalledTimes(1);
    // Mismo id de mensaje con otro contenido (board recreado): sí se envía.
    await second[watcherId("demo")]!.run({ event: posted("9", ev({ summary: "Otro evento." })) });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not deliver concurrently twice for the same message", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { fetch, run } = setup(async () => {
      await gate;
      return ok();
    });
    const a = run(posted("1", ev()));
    const b = run(posted("1", ev()));
    release();
    await Promise.all([a, b]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx and network errors with backoff, then succeeds", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const { fetch, run, log } = setup(
      async () => {
        n++;
        if (n === 1) throw new TypeError("fetch failed");
        if (n === 2) return new Response("", { status: 503 });
        return ok();
      },
      { sleep: async (ms: number) => void sleeps.push(ms), retry: { attempts: 5, baseMs: 100, maxMs: 1000, timeoutMs: 1000 } },
    );
    await run(posted("1", ev()));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
    expect(log.lines.some((l) => l.includes("sent after 3 attempt"))).toBe(true);
    // Ya marcado como enviado: otra entrega del mismo mensaje no sale.
    await run(posted("1", ev()));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempt limit, never throws, and leaves it unsent for a later redelivery", async () => {
    const { fetch, run, log } = setup(async () => new Response("", { status: 500 }), { retry: { attempts: 3 } });
    await expect(run(posted("1", ev()))).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(log.lines.some((l) => l.startsWith("error") && l.includes("HTTP 500"))).toBe(true);
    await run(posted("1", ev()));
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("does not retry a 4xx rejection", async () => {
    const { fetch, run } = setup(async () => new Response("", { status: 400 }));
    await run(posted("1", ev()));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("swallows unexpected errors (a broken sent log) instead of throwing", async () => {
    const broken = { has: () => false, add: () => { throw new Error("disk full"); } };
    const { run, log } = setup(async () => ok(), { sentLog: broken });
    await expect(run(posted("1", ev()))).resolves.toBeUndefined();
    expect(log.lines.some((l) => l.includes("disk full"))).toBe(true);
  });
});

describe("deliverWebhook / backoff", () => {
  it("caps backoff", () => {
    const p = { baseMs: 1000, maxMs: 30_000 };
    expect([1, 2, 3, 4, 5, 6, 7].map((a) => backoffMs(a, p))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it("retries 429 and 408 but not 404", async () => {
    for (const [status, calls] of [[429, 2], [408, 2], [404, 1]] as const) {
      const fetch = vi.fn(async () => new Response("", { status }));
      const r = await deliverWebhook({ url: DEFAULT_TEST_WEBHOOK_URL }, ev(), "d", {
        fetch: fetch as unknown as typeof globalThis.fetch,
        sleep: noSleep,
        retry: { attempts: 2, baseMs: 1, maxMs: 1, timeoutMs: 1000 },
      });
      expect(r.ok).toBe(false);
      expect(fetch).toHaveBeenCalledTimes(calls);
    }
  });
});

describe("FileSentLog", () => {
  it("keeps only the last `max` keys and survives a corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "bnet-sent-"));
    const path = join(dir, "nested", "sent.json");
    const log = new FileSentLog(path, 3);
    for (const k of ["a", "b", "c", "d"]) log.add(k);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(["b", "c", "d"]);
    expect(new FileSentLog(path, 3).has("a")).toBe(false);
    expect(new FileSentLog(path, 3).has("d")).toBe(true);

    writeFileSync(path, "{not json");
    const warns: string[] = [];
    const fresh = new FileSentLog(path, 3, (m) => warns.push(m));
    expect(fresh.has("d")).toBe(false);
    expect(warns).toHaveLength(1);
  });
});

describe("loadWebhookConfig", () => {
  const files: Record<string, string> = {};
  const read = (p: string) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p]!;
  };

  it("defaults to the local test webhook with no config", () => {
    expect(loadWebhookConfig({}, read)).toEqual({ default: { url: DEFAULT_TEST_WEBHOOK_URL }, bots: {} });
  });

  it("reads URL and secret from env, preferring *_FILE", () => {
    files["/run/creds/hook"] = "secret-from-file\n";
    const c = loadWebhookConfig({ FHUB_WEBHOOK_URL: "https://hooks.example.invalid/x", FHUB_WEBHOOK_SECRET: "env", FHUB_WEBHOOK_SECRET_FILE: "/run/creds/hook" }, read);
    expect(c.default).toEqual({ url: "https://hooks.example.invalid/x", secret: "secret-from-file" });
  });

  it("reads per-bot targets from FHUB_WEBHOOKS_FILE", () => {
    files["/etc/fhub/webhooks.json"] = JSON.stringify({
      bots: { "demo-bot": { url: "https://hooks.example.invalid/demo", secretFile: "/run/creds/hook" } },
    });
    const c = loadWebhookConfig({ FHUB_WEBHOOKS_FILE: "/etc/fhub/webhooks.json" }, read);
    expect(c.default).toEqual({ url: DEFAULT_TEST_WEBHOOK_URL });
    expect(c.bots["demo-bot"]).toEqual({ url: "https://hooks.example.invalid/demo", secret: "secret-from-file" });
  });

  it("still accepts the pre-rename BNET_* names, with FHUB_* winning", () => {
    expect(loadWebhookConfig({ BNET_WEBHOOK_URL: "https://hooks.example.invalid/old" }, read).default).toEqual({ url: "https://hooks.example.invalid/old" });
    const both = loadWebhookConfig({ FHUB_WEBHOOK_URL: "https://hooks.example.invalid/new", BNET_WEBHOOK_URL: "https://hooks.example.invalid/old" }, read);
    expect(both.default).toEqual({ url: "https://hooks.example.invalid/new" });
  });

  it("`default: null` turns the fallback off", () => {
    files["/etc/fhub/off.json"] = JSON.stringify({ default: null });
    expect(loadWebhookConfig({ FHUB_WEBHOOKS_FILE: "/etc/fhub/off.json" }, read).default).toBeNull();
  });

  it("rejects bad files without echoing secrets", () => {
    files["/etc/fhub/bad.json"] = JSON.stringify({ bots: { "demo-bot": { url: "ftp://x.invalid", secret: "do-not-echo" } } });
    expect(() => loadWebhookConfig({ FHUB_WEBHOOKS_FILE: "/etc/fhub/bad.json" }, read)).toThrow(ConfigError);
    try {
      loadWebhookConfig({ FHUB_WEBHOOKS_FILE: "/etc/fhub/bad.json" }, read);
    } catch (e) {
      expect(String(e)).not.toContain("do-not-echo");
    }
    expect(() => loadWebhookConfig({ FHUB_WEBHOOKS_FILE: "/missing.json" }, read)).toThrow(ConfigError);
    expect(() => loadWebhookConfig({ FHUB_WEBHOOK_URL: "nope" }, read)).toThrow(ConfigError);
  });
});
