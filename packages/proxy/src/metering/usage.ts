/**
 * Token extraction from upstream responses.
 *
 * Normalised semantics (match UsageRecord):
 *  - inputTokens:      NON-cached input tokens. Anthropic reports this directly;
 *                      OpenAI's prompt_tokens/input_tokens INCLUDE cached tokens,
 *                      so we subtract cached_tokens.
 *  - outputTokens:     all output tokens, reasoning included (billed as output).
 *  - reasoningTokens:  informational subset of outputTokens (OpenAI only).
 *  - cacheWriteTokens: Anthropic cache_creation_input_tokens (OpenAI has none).
 */
import type { ApiFormat } from "@fhub/core";
import { SseParser, type SseEvent } from "./sse.ts";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export const zeroUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 });

const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : undefined);

/** Merge an Anthropic `usage` object (fields present override; values are cumulative). */
export function applyAnthropicUsage(u: Usage, raw: unknown): boolean {
  const x = obj(raw);
  if (!x) return false;
  const set = (k: keyof Usage, v: unknown) => {
    const val = n(v);
    if (val !== undefined) u[k] = val;
  };
  set("inputTokens", x.input_tokens);
  set("outputTokens", x.output_tokens);
  set("cacheReadTokens", x.cache_read_input_tokens);
  set("cacheWriteTokens", x.cache_creation_input_tokens);
  return true;
}

/** OpenAI chat-completions `usage` or Responses API `usage`. */
export function applyOpenAIUsage(u: Usage, raw: unknown): boolean {
  const x = obj(raw);
  if (!x) return false;
  const prompt = n(x.prompt_tokens) ?? n(x.input_tokens);
  const completion = n(x.completion_tokens) ?? n(x.output_tokens);
  const inDetails = obj(x.prompt_tokens_details) ?? obj(x.input_tokens_details);
  const outDetails = obj(x.completion_tokens_details) ?? obj(x.output_tokens_details);
  const cached = n(inDetails?.cached_tokens) ?? 0;
  if (prompt !== undefined) u.inputTokens = Math.max(0, prompt - cached);
  u.cacheReadTokens = cached;
  if (completion !== undefined) u.outputTokens = completion;
  u.reasoningTokens = n(outDetails?.reasoning_tokens) ?? 0;
  return prompt !== undefined || completion !== undefined;
}

/** Non-stream JSON body. Returns null when no usage block is present. */
export function usageFromJson(format: ApiFormat, body: unknown): Usage | null {
  const b = obj(body);
  if (!b) return null;
  const u = zeroUsage();
  const ok = format === "anthropic-messages" ? applyAnthropicUsage(u, b.usage) : applyOpenAIUsage(u, b.usage ?? obj(b.response)?.usage);
  return ok ? u : null;
}

/**
 * Incremental SSE meter: feed decoded text, read `.usage` at the end.
 *  - Anthropic: message_start.message.usage, then message_delta.usage (cumulative)
 *  - OpenAI chat: any chunk with a non-null `usage` (final chunk with include_usage)
 *  - OpenAI Responses: response.completed / response.incomplete / response.failed -> response.usage
 */
export class StreamMeter {
  readonly usage = zeroUsage();
  sawUsage = false;
  /** Upstream signalled an error inside a 200 stream. */
  streamError: string | null = null;
  private readonly parser: SseParser;
  private readonly format: ApiFormat;

  constructor(format: ApiFormat) {
    this.format = format;
    this.parser = new SseParser((e) => this.onEvent(e));
  }

  push(text: string) {
    this.parser.push(text);
  }
  end() {
    this.parser.end();
  }

  private onEvent(e: SseEvent) {
    if (e.data === "[DONE]") return;
    let d: Obj | undefined;
    try {
      d = obj(JSON.parse(e.data));
    } catch {
      return;
    }
    if (!d) return;
    const type = (typeof d.type === "string" ? d.type : e.event) ?? "";
    if (type === "error" || (this.format !== "anthropic-messages" && obj(d.error) && !d.choices)) {
      const err = obj(d.error);
      this.streamError = typeof err?.type === "string" ? err.type : typeof err?.code === "string" ? err.code : "stream-error";
    }
    switch (this.format) {
      case "anthropic-messages":
        if (type === "message_start") this.sawUsage = applyAnthropicUsage(this.usage, obj(d.message)?.usage) || this.sawUsage;
        else if (type === "message_delta") this.sawUsage = applyAnthropicUsage(this.usage, d.usage) || this.sawUsage;
        break;
      case "openai-chat":
        if (d.usage) this.sawUsage = applyOpenAIUsage(this.usage, d.usage) || this.sawUsage;
        break;
      case "openai-responses":
        if (type === "response.completed" || type === "response.incomplete" || type === "response.failed") {
          this.sawUsage = applyOpenAIUsage(this.usage, obj(d.response)?.usage) || this.sawUsage;
          if (type === "response.failed") this.streamError = "response.failed";
        }
        break;
    }
  }
}

export interface StreamTapResult {
  usage: Usage;
  sawUsage: boolean;
  ttftMs: number | null;
  /** "complete" | client went away | upstream stream broke */
  end: "complete" | "aborted" | "error";
  streamError: string | null;
}

/**
 * Wrap an upstream SSE body: bytes pass through untouched while a StreamMeter
 * watches them. `onDone` fires exactly once (complete, client cancel, or error).
 */
export function tapStream(
  body: ReadableStream<Uint8Array>,
  format: ApiFormat,
  now: () => number,
  startedAt: number,
  onDone: (r: StreamTapResult) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const meter = new StreamMeter(format);
  const decoder = new TextDecoder();
  let ttft: number | null = null;
  let done = false;
  const finish = (end: StreamTapResult["end"]) => {
    if (done) return;
    done = true;
    try {
      meter.push(decoder.decode());
      meter.end();
    } catch {
      /* ignore */
    }
    onDone({ usage: meter.usage, sawUsage: meter.sawUsage, ttftMs: ttft, end, streamError: meter.streamError });
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done: rdone } = await reader.read();
        if (rdone) {
          finish("complete");
          controller.close();
          return;
        }
        if (ttft === null) ttft = Math.max(0, now() - startedAt);
        meter.push(decoder.decode(value, { stream: true }));
        controller.enqueue(value);
      } catch (err) {
        finish("error");
        controller.error(err);
      }
    },
    async cancel(reason) {
      finish("aborted");
      await reader.cancel(reason).catch(() => {});
    },
  });
}
