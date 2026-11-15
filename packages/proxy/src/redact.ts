/**
 * Central log redactor. Every log line from the proxy goes through
 * `redact()` before reaching a sink. It masks:
 *  - object keys: authorization, x-api-key, cookie / set-cookie, anything containing
 *    "token", "secret", "password", "apikey"/"api_key"/"api-key", "pepper", "credential"
 *  - string patterns anywhere: `sk-…` style keys, `Bearer …` values, JWT-looking blobs
 */
export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY = /^(authorization|proxy-authorization|x-api-key|x-goog-api-key|cookie|set-cookie)$|token|secret|password|passwd|api[-_]?key|pepper|credential|private[-_]?key/i;

const STRING_PATTERNS: Array<[RegExp, string]> = [
  // OpenAI / Anthropic style keys: sk-..., sk-ant-..., sk-proj-...
  [/\bsk-[A-Za-z0-9_-]{6,}/g, `sk-${REDACTED}`],
  // Authorization header values embedded in strings
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`],
  // JWT-ish (three base64url segments)
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  // key=value query params
  [/([?&](?:key|api_key|token|access_token)=)[^&\s]+/gi, `$1${REDACTED}`],
];

export function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of STRING_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Token *counts* ("inputTokens", "max_tokens", "outputTokenCount") are metrics, not credentials. */
const TOKEN_COUNT_KEY = /tokens$|token_?count$|tokens_details$/i;

export function isSensitiveKey(key: string): boolean {
  if (TOKEN_COUNT_KEY.test(key)) return false;
  return SENSITIVE_KEY.test(key);
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[…]";
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    const o: Record<string, string> = {};
    value.forEach((v, k) => (o[k] = isSensitiveKey(k) ? REDACTED : redactString(v)));
    return o;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? REDACTED : redact(v, depth + 1);
  }
  return out;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void;
}

/** Logger that redacts every message and field before writing a JSON line to `sink`. */
export function createLogger(sink: (line: string) => void = (l) => process.stderr.write(l + "\n"), clock: () => number = Date.now): Logger {
  return {
    log(level, msg, fields) {
      sink(JSON.stringify({ t: new Date(clock()).toISOString(), level, msg: redactString(msg), ...(redact(fields ?? {}) as object) }));
    },
  };
}

export const silentLogger: Logger = { log() {} };
