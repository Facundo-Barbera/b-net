/**
 * SYNTHETIC SSE fixtures, hand-written to mirror the public event shapes of each
 * API. Not captured from real traffic; contain no prompts of value and no credentials.
 */

/** Anthropic Messages stream: usage in message_start (input/cache) and message_delta (output, cumulative). */
export const ANTHROPIC_STREAM = [
  "event: message_start",
  'data: {"type":"message_start","message":{"id":"msg_dummy","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"usage":{"input_tokens":1200,"cache_creation_input_tokens":300,"cache_read_input_tokens":5000,"output_tokens":1}}}',
  "",
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  "",
  ": keep-alive comment",
  "",
  "event: ping",
  'data: {"type":"ping"}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hola"}}',
  "",
  "event: content_block_stop",
  'data: {"type":"content_block_stop","index":0}',
  "",
  "event: message_delta",
  'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":420}}',
  "",
  "event: message_stop",
  'data: {"type":"message_stop"}',
  "",
  "",
].join("\r\n");

/** Anthropic stream that fails mid-way with an in-band error event. */
export const ANTHROPIC_STREAM_ERROR = [
  "event: message_start",
  'data: {"type":"message_start","message":{"id":"msg_dummy2","usage":{"input_tokens":10,"output_tokens":1}}}',
  "",
  "event: error",
  'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
  "",
  "",
].join("\n");

/** OpenAI chat completions stream with include_usage: final chunk has empty choices + usage. */
export const OPENAI_CHAT_STREAM = [
  'data: {"id":"chatcmpl-dummy","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}],"usage":null}',
  "",
  'data: {"id":"chatcmpl-dummy","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hi"}}],"usage":null}',
  "",
  'data: {"id":"chatcmpl-dummy","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":null}',
  "",
  'data: {"id":"chatcmpl-dummy","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":900,"completion_tokens":250,"total_tokens":1150,"prompt_tokens_details":{"cached_tokens":400},"completion_tokens_details":{"reasoning_tokens":100}}}',
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

/** OpenAI Responses API stream: usage in response.completed. */
export const OPENAI_RESPONSES_STREAM = [
  "event: response.created",
  'data: {"type":"response.created","response":{"id":"resp_dummy","status":"in_progress","usage":null}}',
  "",
  "event: response.output_text.delta",
  'data: {"type":"response.output_text.delta","delta":"Hi"}',
  "",
  "event: response.completed",
  'data: {"type":"response.completed","response":{"id":"resp_dummy","status":"completed","usage":{"input_tokens":2000,"input_tokens_details":{"cached_tokens":1500},"output_tokens":300,"output_tokens_details":{"reasoning_tokens":200},"total_tokens":2300}}}',
  "",
  "",
].join("\n");

export const ANTHROPIC_JSON = {
  id: "msg_dummy",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [{ type: "text", text: "ok" }],
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
};

export const OPENAI_CHAT_JSON = {
  id: "chatcmpl-dummy",
  object: "chat.completion",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 20 } },
};

export const OPENAI_RESPONSES_JSON = {
  id: "resp_dummy",
  object: "response",
  status: "completed",
  usage: { input_tokens: 500, input_tokens_details: { cached_tokens: 0 }, output_tokens: 80, output_tokens_details: { reasoning_tokens: 30 } },
};
