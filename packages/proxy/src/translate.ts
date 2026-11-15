/**
 * Cross-format translation (OpenAI chat/responses <-> Anthropic messages).
 *
 * PHASE 2. In phase 1 every client endpoint only reaches upstreams that speak
 * the same wire format. When a request would need translation the proxy answers
 * 501 with this message instead of guessing. See docs/cliproxyapi-parity.md.
 *
 * Notes for the phase-2 implementation:
 *  - requests: system prompt placement, tool/function schemas, images, stop
 *    sequences, max_tokens (required on Anthropic), reasoning effort/thinking budget
 *  - streams: re-emit Anthropic content_block_* events as OpenAI chat chunks
 *    (and Responses API events), preserving usage for metering
 *  - errors: map error shapes and status codes both ways
 */
import type { ApiFormat } from "@b-net/core";
import type { UpstreamFormat } from "./config.ts";

export class TranslationNotImplemented extends Error {
  constructor(from: ApiFormat, to: UpstreamFormat) {
    super(`cross-format translation ${from} -> ${to} upstream is not implemented yet (phase 2)`);
    this.name = "TranslationNotImplemented";
  }
}

export function endpointUpstreamFormat(f: ApiFormat): UpstreamFormat {
  return f === "anthropic-messages" ? "anthropic" : "openai";
}

export function translateRequest(from: ApiFormat, to: UpstreamFormat, _body: unknown): never {
  throw new TranslationNotImplemented(from, to);
}
