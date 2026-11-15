import { describe, expect, it } from "vitest";
import { SseParser, type SseEvent } from "../src/metering/sse.ts";
import { StreamMeter, tapStream, usageFromJson } from "../src/metering/usage.ts";
import { chunked } from "./helpers.ts";
import { ANTHROPIC_JSON, ANTHROPIC_STREAM, ANTHROPIC_STREAM_ERROR, OPENAI_CHAT_JSON, OPENAI_CHAT_STREAM, OPENAI_RESPONSES_JSON, OPENAI_RESPONSES_STREAM } from "./fixtures/sse.ts";

function meter(format: "anthropic-messages" | "openai-chat" | "openai-responses", text: string, chunk = 5) {
  const m = new StreamMeter(format);
  for (let i = 0; i < text.length; i += chunk) m.push(text.slice(i, i + chunk));
  m.end();
  return m;
}

describe("SseParser", () => {
  it("handles \\n, \\r\\n, comments, multi-line data and arbitrary splits", () => {
    const text = "event: a\r\ndata: 1\r\ndata: 2\r\n\r\n: comment\n\ndata: x\n\nevent: b\rdata: y\r\r";
    for (const size of [1, 2, 3, 7, 100]) {
      const got: SseEvent[] = [];
      const p = new SseParser((e) => got.push(e));
      for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size));
      p.end();
      expect(got, `chunk ${size}`).toEqual([
        { event: "a", data: "1\n2" },
        { event: null, data: "x" },
        { event: "b", data: "y" },
      ]);
    }
  });
});

describe("stream metering", () => {
  it("Anthropic: message_start + cumulative message_delta", () => {
    for (const size of [1, 4, 64]) {
      const m = meter("anthropic-messages", ANTHROPIC_STREAM, size);
      expect(m.sawUsage).toBe(true);
      expect(m.usage).toEqual({ inputTokens: 1200, outputTokens: 420, cacheReadTokens: 5000, cacheWriteTokens: 300, reasoningTokens: 0 });
      expect(m.streamError).toBeNull();
    }
  });

  it("Anthropic: in-band error event is flagged", () => {
    const m = meter("anthropic-messages", ANTHROPIC_STREAM_ERROR);
    expect(m.streamError).toBe("overloaded_error");
    expect(m.usage.inputTokens).toBe(10);
  });

  it("OpenAI chat: final usage chunk, cached tokens subtracted from input", () => {
    const m = meter("openai-chat", OPENAI_CHAT_STREAM);
    expect(m.usage).toEqual({ inputTokens: 500, outputTokens: 250, cacheReadTokens: 400, cacheWriteTokens: 0, reasoningTokens: 100 });
  });

  it("OpenAI Responses: response.completed", () => {
    const m = meter("openai-responses", OPENAI_RESPONSES_STREAM);
    expect(m.usage).toEqual({ inputTokens: 500, outputTokens: 300, cacheReadTokens: 1500, cacheWriteTokens: 0, reasoningTokens: 200 });
  });

  it("no usage in stream -> sawUsage false", () => {
    const m = meter("openai-chat", 'data: {"choices":[{"delta":{"content":"x"}}]}\n\ndata: [DONE]\n\n');
    expect(m.sawUsage).toBe(false);
  });
});

describe("JSON metering", () => {
  it("Anthropic / OpenAI chat / Responses bodies", () => {
    expect(usageFromJson("anthropic-messages", ANTHROPIC_JSON)).toEqual({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000, cacheWriteTokens: 0, reasoningTokens: 0 });
    expect(usageFromJson("openai-chat", OPENAI_CHAT_JSON)).toEqual({ inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 0, reasoningTokens: 0 });
    expect(usageFromJson("openai-responses", OPENAI_RESPONSES_JSON)).toEqual({ inputTokens: 500, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 30 });
    expect(usageFromJson("openai-chat", { choices: [] })).toBeNull();
  });
});

describe("tapStream", () => {
  it("passes bytes through unchanged and reports usage once at the end", async () => {
    const results: unknown[] = [];
    let t = 0;
    const s = tapStream(chunked(ANTHROPIC_STREAM, 3), "anthropic-messages", () => (t += 5), 0, (r) => results.push(r));
    const out = await new Response(s).text();
    expect(out).toBe(ANTHROPIC_STREAM);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ end: "complete", sawUsage: true, ttftMs: 5, usage: { outputTokens: 420 } });
  });

  it("reports aborted when the consumer cancels", async () => {
    const results: Array<{ end: string }> = [];
    const s = tapStream(chunked(ANTHROPIC_STREAM, 10), "anthropic-messages", () => 0, 0, (r) => results.push(r));
    const reader = s.getReader();
    await reader.read();
    await reader.cancel("client went away");
    expect(results).toEqual([expect.objectContaining({ end: "aborted" })]);
  });

  it("reports error when the upstream stream breaks", async () => {
    const results: Array<{ end: string }> = [];
    const s = tapStream(chunked(ANTHROPIC_STREAM, 10, { failAfter: 3 }), "anthropic-messages", () => 0, 0, (r) => results.push(r));
    await expect(new Response(s).text()).rejects.toThrow();
    expect(results).toEqual([expect.objectContaining({ end: "error" })]);
  });
});
