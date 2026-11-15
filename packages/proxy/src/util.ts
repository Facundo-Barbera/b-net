import { randomBytes as nodeRandomBytes, timingSafeEqual, createHash } from "node:crypto";

/** Injected time source (ms since epoch). Tests use a fake clock. */
export interface Clock {
  now(): number;
}
export const systemClock: Clock = { now: () => Date.now() };

export const iso = (ms: number): string => new Date(ms).toISOString();

/* ------------------------------------------------------------------ *
 * ULID (Crockford base32, 48-bit time + 80-bit random), monotonic
 * within the same millisecond so ids are strictly increasing and can be
 * used as pagination cursors.
 * ------------------------------------------------------------------ */
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type UlidFactory = () => string;

export function createUlidFactory(clock: Clock = systemClock, rand: (n: number) => Uint8Array = nodeRandomBytes): UlidFactory {
  let lastTime = -1;
  let lastRand: number[] = [];
  return () => {
    let t = clock.now();
    if (t < lastTime) t = lastTime; // clock went backwards: stay monotonic
    let r: number[] | null = null;
    if (t === lastTime) {
      r = lastRand.slice();
      // increment the 80-bit random part as 16 base32 digits
      let i = r.length - 1;
      while (i >= 0) {
        if (r[i]! < 31) {
          r[i]!++;
          break;
        }
        r[i] = 0;
        i--;
      }
      if (i < 0) {
        // overflow (practically impossible): borrow the next millisecond
        t = lastTime + 1;
        r = null;
      }
    }
    if (r === null) r = Array.from(rand(16), (b) => b & 31);
    lastTime = t;
    lastRand = r;
    let timePart = "";
    let tt = t;
    for (let i = 0; i < 10; i++) {
      timePart = B32[tt % 32] + timePart;
      tt = Math.floor(tt / 32);
    }
    return timePart + r.map((d) => B32[d]).join("");
  };
}

/* ------------------------------------------------------------------ *
 * Glob matching for model patterns ("claude-*", "gpt-5?", exact ids).
 * ------------------------------------------------------------------ */
const globCache = new Map<string, RegExp>();
export function globMatch(pattern: string, value: string): boolean {
  let re = globCache.get(pattern);
  if (!re) {
    const src = pattern
      .split("")
      .map((c) => (c === "*" ? ".*" : c === "?" ? "." : c.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
      .join("");
    re = new RegExp(`^${src}$`, "i");
    globCache.set(pattern, re);
  }
  return re.test(value);
}

/** Empty list = everything allowed. */
export const anyGlob = (patterns: readonly string[], value: string): boolean =>
  patterns.length === 0 || patterns.some((p) => globMatch(p, value));

/** Constant-time string comparison (pads to equal length so length isn't leaked early). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
