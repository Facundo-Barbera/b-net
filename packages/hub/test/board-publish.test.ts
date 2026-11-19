import { describe, expect, it, vi } from "vitest";
import type { BnetEventV1 } from "@b-net/core";
import { bnetEventFromMessage } from "../src/board/events.ts";
import {
  BNET_EVENT_JSON_SCHEMA,
  BoardApiError,
  PR_STATE_LABEL,
  bnetEventPost,
  prPost,
  publishEvent,
  publishPr,
  registerEventSchema,
  type BoardClient,
} from "../src/board/publish.ts";

const ev = (over: Partial<BnetEventV1> = {}): BnetEventV1 => ({
  schema: "bnet.event",
  version: 1,
  kind: "question",
  project: "demo",
  bot: "demo-bot",
  summary: "¿Seguimos con la opción B?",
  at: "2026-11-19T10:00:00.000Z",
  ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function client(handler: (method: string, path: string, body: unknown) => Response) {
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url);
    return handler(init.method ?? "GET", u.pathname.replace(/^\/api\/board/, "") + u.search, init.body ? JSON.parse(init.body as string) : undefined);
  });
  const c: BoardClient = { url: "http://127.0.0.1:4100/api/board/", token: "tok-not-real", fetch: fetch as unknown as typeof globalThis.fetch };
  return { c, fetch };
}

describe("bnetEventPost", () => {
  it("posts to <slug>/eventos with labels and a block the watcher can read back", () => {
    const p = bnetEventPost(ev({ thread: "t-9" }));
    expect(p.channel).toBe("demo/eventos");
    expect(p.labels).toEqual({ project: "demo", bot: "demo-bot", thread: "t-9" });
    expect(p.text.startsWith("¿Seguimos con la opción B?\n\n```json#bnet.event@1\n")).toBe(true);
    // Simula el parseo de Board: el JSON dentro del fence es el bloque.
    const data = JSON.parse(p.text.split("```json#bnet.event@1\n")[1]!.split("\n```")[0]!);
    expect(bnetEventFromMessage({ id: "1", channel: p.channel, blocks: [{ schema: "bnet.event", version: 1, data }] })).toEqual(ev({ thread: "t-9" }));
  });

  it("derives the idempotency id from the content minus `at`", () => {
    const a = bnetEventPost(ev());
    expect(bnetEventPost(ev({ at: "2026-11-19T11:00:00.000Z" })).id).toBe(a.id);
    expect(bnetEventPost(ev({ summary: "Otra pregunta." })).id).not.toBe(a.id);
    expect(a.id).toMatch(/^bnet-ev-[0-9a-f]{32}$/);
  });

  it("refuses an invalid event before calling the board", () => {
    expect(() => bnetEventPost(ev({ project: "No Slug" }))).toThrow();
    expect(() => bnetEventPost({ ...ev(), kind: "nope" as never })).toThrow();
  });

  it("the JSON Schema only uses keywords Board accepts", () => {
    const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "minItems", "maxItems", "minLength", "maxLength", "format", "minimum", "maximum", "enum", "const", "title", "description"]);
    const walk = (s: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(s)) {
        expect(allowed.has(k)).toBe(true);
        if (k === "properties") for (const sub of Object.values(v as Record<string, Record<string, unknown>>)) walk(sub);
      }
    };
    walk(BNET_EVENT_JSON_SCHEMA);
    expect(Object.keys(BNET_EVENT_JSON_SCHEMA.properties).sort()).toEqual(["at", "bot", "kind", "link", "project", "schema", "summary", "thread", "version"]);
  });
});

describe("publishEvent", () => {
  it("POSTs /messages with the bearer token", async () => {
    const { c, fetch } = client((m, p, b) => {
      expect([m, p]).toEqual(["POST", "/messages"]);
      expect((b as { channel: string }).channel).toBe("demo/eventos");
      return json(201, { message: { id: "12" } });
    });
    expect(await publishEvent(c, ev())).toEqual({ id: "12", created: true });
    const init = fetch.mock.calls[0]![1];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-not-real");
  });

  it("returns the existing message on duplicate_id", async () => {
    const id = bnetEventPost(ev()).id;
    const { c } = client((m, p) => {
      if (m === "POST") return json(409, { error: { code: "duplicate_id", message: "taken" } });
      expect(p).toBe(`/posts/${id}`);
      return json(200, { message: { id: "12" } });
    });
    expect(await publishEvent(c, ev())).toEqual({ id: "12", created: false });
  });

  it("surfaces other API errors with code, without the token", async () => {
    const { c } = client(() => json(400, { error: { code: "schema_not_found", message: "no bnet.event@1" } }));
    const err = await publishEvent(c, ev()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BoardApiError);
    expect((err as BoardApiError).code).toBe("schema_not_found");
    expect(String(err)).not.toContain("tok-not-real");
  });
});

describe("PRs", () => {
  const pr = { project: "demo", ref: "acme/web#12", title: "Arregla [el] login\ncon saltos", url: "https://github.com/acme/web/pull/12", state: "abierto" as const };

  it("prPost builds a link, labels and a stable id", () => {
    const p = prPost(pr);
    expect(p.channel).toBe("demo/prs");
    expect(p.text).toBe("[Arregla \\[el\\] login con saltos](https://github.com/acme/web/pull/12)");
    expect(p.labels).toEqual({ project: "demo", pr: "acme/web#12", [PR_STATE_LABEL]: "abierto" });
    expect(prPost({ ...pr, title: "otro", state: "fusionado" }).id).toBe(p.id);
    expect(() => prPost({ ...pr, ref: "acme/web" })).toThrow();
    expect(() => prPost({ ...pr, url: "javascript:alert(1)" })).toThrow();
  });

  it("creates the thread when none has the pr label", async () => {
    const calls: string[] = [];
    const { c } = client((m, p) => {
      calls.push(`${m} ${p}`);
      if (m === "GET") return json(200, { threads: [] });
      return json(201, { message: { id: "30" } });
    });
    expect(await publishPr(c, pr)).toEqual({ id: "30", created: true });
    const q = new URLSearchParams(calls[0]!.split("?")[1]);
    expect(q.get("channel")).toBe("demo/prs");
    expect(q.get("label")).toBe("pr=acme/web#12");
    expect(calls[1]).toBe("POST /messages");
  });

  it("only relabels the state of an existing thread", async () => {
    const bodies: unknown[] = [];
    const { c, fetch } = client((m, p, b) => {
      if (m === "GET") return json(200, { threads: [{ message: { id: "30", labels: { [PR_STATE_LABEL]: "abierto" } } }] });
      expect(p).toBe("/messages/30/labels");
      bodies.push(b);
      return json(200, { ok: true });
    });
    expect(await publishPr(c, { ...pr, state: "fusionado" })).toEqual({ id: "30", created: false });
    expect(bodies).toEqual([{ set: { [PR_STATE_LABEL]: "fusionado" } }]);
    // Mismo estado: ni siquiera relabel.
    await publishPr(c, { ...pr, state: "abierto" });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe("registerEventSchema", () => {
  it("POSTs /schemas with bnet.event@1", async () => {
    const { c } = client((m, p, b) => {
      expect([m, p]).toEqual(["POST", "/schemas"]);
      expect(b).toMatchObject({ name: "bnet.event", version: 1, schema: BNET_EVENT_JSON_SCHEMA });
      return json(200, { schema: {}, created: false });
    });
    expect(await registerEventSchema(c)).toEqual({ created: false });
  });
});
