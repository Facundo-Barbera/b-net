import { UsageRecord } from "@fhub/core";
import { describe, expect, it } from "vitest";
import { createProxyApp } from "../src/app.ts";
import { account, baseConfig, CLIENT_KEY, clientRequest, credentialOf, jsonReply, LIMITED_KEY, makeDeps, ScriptedUpstream, sseReply, chunked } from "./helpers.ts";
import { ANTHROPIC_JSON, ANTHROPIC_STREAM, ANTHROPIC_STREAM_ERROR, OPENAI_CHAT_JSON, OPENAI_CHAT_STREAM, OPENAI_RESPONSES_STREAM } from "./fixtures/sse.ts";

const msg = (extra: Record<string, unknown> = {}) => ({ model: "claude-opus-5-5", max_tokens: 64, messages: [{ role: "user", content: "hi" }], ...extra });
const chat = (extra: Record<string, unknown> = {}) => ({ model: "gpt-5", messages: [{ role: "user", content: "hi" }], ...extra });

function setup(over: Parameters<typeof makeDeps>[0] = {}) {
  const ctx = makeDeps(over);
  return { ...ctx, app: createProxyApp(ctx.deps) };
}

describe("client auth", () => {
  it("rejects missing / wrong keys in the endpoint's error format", async () => {
    const { app, upstream } = setup();
    const r1 = await app(clientRequest("/v1/messages", msg(), { key: null }));
    expect(r1.status).toBe(401);
    expect(await r1.json()).toMatchObject({ type: "error", error: { type: "authentication_error" } });
    const r2 = await app(clientRequest("/v1/chat/completions", chat(), { key: "bxk-wrong" }));
    expect(r2.status).toBe(401);
    expect(await r2.json()).toMatchObject({ error: { type: "authentication_error" } });
    expect(upstream.calls).toHaveLength(0);
  });

  it("accepts x-api-key (Anthropic SDK style)", async () => {
    const { app, upstream } = setup();
    upstream.on("anthropic-a", jsonReply(ANTHROPIC_JSON));
    const r = await app(clientRequest("/v1/messages", msg(), { key: null, headers: { "x-api-key": CLIENT_KEY } }));
    expect(r.status).toBe(200);
  });

  it("enforces allowedModels globs", async () => {
    const { app, upstream } = setup();
    const r = await app(clientRequest("/v1/messages", msg(), { key: LIMITED_KEY }));
    expect(r.status).toBe(403);
    upstream.on("anthropic-a", jsonReply(ANTHROPIC_JSON));
    const ok = await app(clientRequest("/v1/messages", msg({ model: "claude-sonnet-5-5" }), { key: LIMITED_KEY }));
    expect(ok.status).toBe(200);
  });
});

describe("passthrough", () => {
  it("Anthropic non-stream: forwards body, swaps credentials, records usage + cost", async () => {
    const { app, upstream, store } = setup();
    upstream.on("anthropic-a", jsonReply({ ...ANTHROPIC_JSON, model: "claude-opus-5-5" }, 200, { "request-id": "req_dummy", "anthropic-ratelimit-unified-5h-utilization": "0.5" }));
    const body = msg();
    const r = await app(clientRequest("/v1/messages", body, { headers: { "anthropic-version": "2023-06-01", "anthropic-beta": "dummy-beta", cookie: "session=dummy" } }));
    expect(r.status).toBe(200);
    expect(r.headers.get("request-id")).toBe("req_dummy");
    expect(r.headers.get("anthropic-ratelimit-unified-5h-utilization")).toBeNull();
    const call = upstream.calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(call.body)).toEqual(body);
    expect(call.headers.get("x-api-key")).toBe(credentialOf("anthropic-a"));
    expect(call.headers.get("authorization")).toBeNull(); // client's bearer never forwarded
    expect(call.headers.get("cookie")).toBeNull();
    expect(call.headers.get("anthropic-beta")).toBe("dummy-beta");
    const rec = store.recent(1)[0]!;
    expect(UsageRecord.safeParse(rec).success).toBe(true);
    expect(rec).toMatchObject({ clientId: "t3-test", accountId: "anthropic-a", format: "anthropic-messages", outcome: "ok", stream: false, inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, failedOver: [] });
    // opus 5.5: 100*4 + 50*20 + 1000*0.2 = 1600 µ$
    expect(rec.costUsd).toBeCloseTo(0.0016, 9);
  });

  it("OAuth subscription accounts send a bearer token", async () => {
    const { app, upstream } = setup({ config: baseConfig({ accounts: [account("max-1", { authKind: "oauth-subscription" })] }) });
    upstream.on("max-1", jsonReply(ANTHROPIC_JSON));
    await app(clientRequest("/v1/messages", msg()));
    expect(upstream.calls[0]!.headers.get("authorization")).toBe(`Bearer ${credentialOf("max-1")}`);
    expect(upstream.calls[0]!.headers.get("x-api-key")).toBeNull();
    expect(upstream.calls[0]!.headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("Anthropic SSE: byte-identical stream, usage recorded after the stream ends", async () => {
    const { app, upstream, store, clock } = setup();
    upstream.on("anthropic-a", () => {
      clock.advance(250);
      return sseReply(ANTHROPIC_STREAM);
    });
    const r = await app(clientRequest("/v1/messages", msg({ stream: true })));
    expect(r.headers.get("content-type")).toBe("text/event-stream");
    expect(store.recent(1)).toHaveLength(0); // not yet: stream not consumed
    expect(await r.text()).toBe(ANTHROPIC_STREAM);
    const rec = store.recent(1)[0]!;
    expect(rec).toMatchObject({ stream: true, outcome: "ok", inputTokens: 1200, outputTokens: 420, cacheReadTokens: 5000, cacheWriteTokens: 300, ttftMs: 250 });
    expect(rec.costUsd).toBeCloseTo(0.0157, 9);
  });

  it("OpenAI chat stream: injects include_usage and meters the final chunk", async () => {
    const { app, upstream, store } = setup();
    upstream.on("openai-a", sseReply(OPENAI_CHAT_STREAM));
    const r = await app(clientRequest("/v1/chat/completions", chat({ stream: true })));
    expect(await r.text()).toBe(OPENAI_CHAT_STREAM);
    expect(upstream.calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(upstream.calls[0]!.headers.get("authorization")).toBe(`Bearer ${credentialOf("openai-a")}`);
    expect(JSON.parse(upstream.calls[0]!.body).stream_options).toEqual({ include_usage: true });
    expect(store.recent(1)[0]).toMatchObject({ format: "openai-chat", inputTokens: 500, outputTokens: 250, cacheReadTokens: 400, reasoningTokens: 100, costUsd: null });
  });

  it("OpenAI chat non-stream body is forwarded verbatim (no rewrite)", async () => {
    const { app, upstream, store } = setup();
    upstream.on("openai-a", jsonReply(OPENAI_CHAT_JSON));
    const raw = JSON.stringify(chat());
    const req = new Request("http://proxy.test/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${CLIENT_KEY}`, "content-type": "application/json" }, body: raw });
    expect((await app(req)).status).toBe(200);
    expect(upstream.calls[0]!.body).toBe(raw);
    expect(store.recent(1)[0]).toMatchObject({ inputTokens: 100, outputTokens: 30, cacheReadTokens: 20 });
  });

  it("Responses API stream is metered from response.completed", async () => {
    const { app, upstream, store } = setup();
    upstream.on("openai-a", sseReply(OPENAI_RESPONSES_STREAM));
    const r = await app(clientRequest("/v1/responses", { model: "gpt-5", input: "hi", stream: true }));
    await r.text();
    expect(upstream.calls[0]!.url).toBe("https://api.openai.com/v1/responses");
    expect(store.recent(1)[0]).toMatchObject({ format: "openai-responses", inputTokens: 500, outputTokens: 300, cacheReadTokens: 1500 });
  });

  it("routes rewrite the upstream model and restrict accounts", async () => {
    const cfg = baseConfig({ routes: [{ match: "opus", provider: "anthropic", upstreamModel: "claude-opus-5-5", accounts: ["anthropic-b"] }] });
    const { app, upstream, store } = setup({ config: cfg });
    upstream.on("anthropic-b", jsonReply(ANTHROPIC_JSON));
    await app(clientRequest("/v1/messages", msg({ model: "opus" })));
    expect(JSON.parse(upstream.calls[0]!.body).model).toBe("claude-opus-5-5");
    expect(store.recent(1)[0]).toMatchObject({ accountId: "anthropic-b", model: "claude-opus-5-5", requestedModel: "opus" });
  });

  it("count_tokens passes through without a usage record", async () => {
    const { app, upstream, store } = setup();
    upstream.on("anthropic-a", jsonReply({ input_tokens: 42 }));
    const r = await app(clientRequest("/v1/messages/count_tokens", msg()));
    expect(await r.json()).toEqual({ input_tokens: 42 });
    expect(upstream.calls[0]!.url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
    expect(store.recent(10)).toHaveLength(0);
  });

  it("upstream 400 is returned as-is, no failover, recorded as client-error", async () => {
    const { app, upstream, store, deps } = setup();
    upstream.on("anthropic-a", jsonReply({ type: "error", error: { type: "invalid_request_error", message: "bad" } }, 400));
    const r = await app(clientRequest("/v1/messages", msg()));
    expect(r.status).toBe(400);
    expect(upstream.calls).toHaveLength(1);
    expect(store.recent(1)[0]!.outcome).toBe("client-error");
    expect(deps.pool.stateOf("anthropic-a")).toBe("active");
  });
});

describe("phase-1 limits", () => {
  it("cross-format request -> 501 (translation is phase 2)", async () => {
    const cfg = baseConfig({ routes: [{ match: "claude-*", provider: "anthropic", upstreamModel: null, accounts: [] }] });
    const { app, upstream } = setup({ config: cfg });
    const r = await app(clientRequest("/v1/chat/completions", chat({ model: "claude-opus-5-5" })));
    expect(r.status).toBe(501);
    expect((await r.json()).error.message).toMatch(/phase 2/);
    expect(upstream.calls).toHaveLength(0);
  });

  it("unknown endpoint and bad bodies", async () => {
    const { app } = setup();
    expect((await app(clientRequest("/v1/completions", chat()))).status).toBe(404);
    expect((await app(clientRequest("/v1/messages", { messages: [] }))).status).toBe(400);
    const bad = new Request("http://proxy.test/v1/messages", { method: "POST", headers: { authorization: `Bearer ${CLIENT_KEY}` }, body: "{not json" });
    expect((await app(bad)).status).toBe(400);
  });
});

describe("failover", () => {
  it("429 on the first account fails over to the next one before anything is sent", async () => {
    const { app, upstream, store, deps } = setup();
    upstream.on("anthropic-a", jsonReply({ type: "error", error: { type: "rate_limit_error" } }, 429, { "retry-after": "30" }));
    upstream.on("anthropic-b", jsonReply(ANTHROPIC_JSON));
    const r = await app(clientRequest("/v1/messages", msg()));
    expect(r.status).toBe(200);
    expect(upstream.accountsCalled()).toEqual(["anthropic-a", "anthropic-b"]);
    expect(store.recent(1)[0]).toMatchObject({ accountId: "anthropic-b", failedOver: ["anthropic-a"], outcome: "ok" });
    expect(deps.pool.stateOf("anthropic-a")).toBe("cooldown");
  });

  it("429 sequence on all accounts -> 429 to the client with retry-after, then recovery after cooldown", async () => {
    const { app, upstream, store, clock } = setup();
    upstream.on("anthropic-a", jsonReply({ type: "error" }, 429, { "retry-after": "20" }));
    upstream.on("anthropic-b", jsonReply({ type: "error" }, 429, { "retry-after": "40" }));
    const r = await app(clientRequest("/v1/messages", msg()));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBe("20");
    expect(store.recent(1)[0]).toMatchObject({ outcome: "rate-limited", failedOver: ["anthropic-a"], accountId: "anthropic-b" });

    // while both cool down: no upstream call at all, 429 from the proxy itself
    const r2 = await app(clientRequest("/v1/messages", msg()));
    expect(r2.status).toBe(429);
    expect(upstream.calls).toHaveLength(2);
    expect(store.recent(1)[0]).toMatchObject({ outcome: "rate-limited", accountId: "none" });

    clock.advance(20_000);
    upstream.on("anthropic-a", jsonReply(ANTHROPIC_JSON));
    const r3 = await app(clientRequest("/v1/messages", msg()));
    expect(r3.status).toBe(200);
    expect(upstream.accountsCalled().at(-1)).toBe("anthropic-a");
  });

  it("401 marks the account as error and fails over; timeouts and 5xx too", async () => {
    const cfg = baseConfig({ accounts: [account("a1"), account("a2"), account("a3"), account("a4")] });
    const { app, upstream, deps } = setup({ config: cfg });
    upstream.on("a1", jsonReply({}, 401));
    const timeout = new DOMException("upstream headers timeout", "TimeoutError");
    upstream.on("a2", timeout as unknown as Error);
    upstream.on("a3", jsonReply({}, 529));
    upstream.on("a4", jsonReply(ANTHROPIC_JSON));
    const r = await app(clientRequest("/v1/messages", msg()));
    expect(r.status).toBe(200);
    expect(deps.pool.stateOf("a1")).toBe("error");
    expect(deps.pool.stateOf("a2")).toBe("cooldown");
    expect(deps.pool.stateOf("a3")).toBe("cooldown");
    expect(deps.pool.get("a2")!.lastError).toMatch(/^timeout/);
  });

  it("404 model -> per-model cooldown and failover", async () => {
    const { app, upstream, deps } = setup();
    upstream.on("anthropic-a", jsonReply({ type: "error", error: { type: "not_found_error" } }, 404));
    upstream.on("anthropic-b", jsonReply(ANTHROPIC_JSON));
    expect((await app(clientRequest("/v1/messages", msg()))).status).toBe(200);
    expect(deps.pool.stateOf("anthropic-a")).toBe("active");
    expect(deps.pool.get("anthropic-a")!.modelCooldowns.has("claude-opus-5-5")).toBe(true);
  });

  it("all accounts failing with mixed errors -> failover-exhausted, last upstream status", async () => {
    const { app, upstream, store } = setup();
    upstream.on("anthropic-a", jsonReply({}, 500));
    upstream.on("anthropic-b", jsonReply({ type: "error" }, 429));
    const r = await app(clientRequest("/v1/messages", msg()));
    expect(r.status).toBe(429);
    expect(store.recent(1)[0]!.outcome).toBe("failover-exhausted");
  });

  it("NO failover once the stream has started: a mid-stream break is recorded, not retried", async () => {
    const { app, upstream, store } = setup();
    upstream.on("anthropic-a", new Response(chunked(ANTHROPIC_STREAM, 20, { failAfter: 2 }), { headers: { "content-type": "text/event-stream" } }));
    upstream.on("anthropic-b", sseReply(ANTHROPIC_STREAM));
    const r = await app(clientRequest("/v1/messages", msg({ stream: true })));
    await expect(r.text()).rejects.toThrow();
    expect(upstream.accountsCalled()).toEqual(["anthropic-a"]);
    expect(store.recent(1)[0]).toMatchObject({ accountId: "anthropic-a", outcome: "upstream-error" });
  });

  it("in-band stream error event is recorded as upstream-error", async () => {
    const { app, upstream, store } = setup();
    upstream.on("anthropic-a", sseReply(ANTHROPIC_STREAM_ERROR));
    await (await app(clientRequest("/v1/messages", msg({ stream: true })))).text();
    expect(store.recent(1)[0]!.outcome).toBe("upstream-error");
  });

  it("client cancelling the stream -> outcome aborted", async () => {
    const { app, upstream, store } = setup();
    upstream.on("anthropic-a", sseReply(ANTHROPIC_STREAM));
    const r = await app(clientRequest("/v1/messages", msg({ stream: true })));
    const reader = r.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(store.recent(1)[0]!.outcome).toBe("aborted");
  });

  it("maxAttempts bounds the failover chain", async () => {
    const cfg = baseConfig({ accounts: [account("a1"), account("a2"), account("a3")], routing: { maxAttempts: 2 } });
    const { app, upstream } = setup({ config: cfg });
    upstream.fallback = jsonReply({}, 503);
    upstream.on("a1", jsonReply({}, 503)).on("a2", jsonReply({}, 503));
    const r = await app(clientRequest("/v1/messages", msg()));
    expect(r.status).toBe(503);
    expect(upstream.calls).toHaveLength(2);
  });
});

describe("GET /v1/models", () => {
  it("OpenAI shape by default, Anthropic shape with anthropic-version, filtered per client", async () => {
    const { app } = setup();
    const r = await app(clientRequest("/v1/models", null, { method: "GET" }));
    const body = await r.json();
    expect(body.object).toBe("list");
    expect(body.data.map((m: { id: string }) => m.id)).toContain("claude-opus-5-5");
    const r2 = await app(clientRequest("/v1/models", null, { method: "GET", key: LIMITED_KEY, headers: { "anthropic-version": "2023-06-01" } }));
    const b2 = await r2.json();
    expect(b2.data.every((m: { id: string; type: string }) => m.id.startsWith("claude-sonnet-") && m.type === "model")).toBe(true);
    expect(b2.has_more).toBe(false);
  });
});

describe("scripted upstream sanity", () => {
  it("throws when nothing is scripted (tests never hit the network)", async () => {
    const up = new ScriptedUpstream();
    await expect(up.fetch("https://example.invalid", {})).rejects.toThrow(/no scripted reply/);
  });
});
