import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Deliverable } from "@fhub/core";
import { SAMPLES, setup } from "./projects-helpers.ts";

let env: Awaited<ReturnType<typeof setup>>;
afterEach(() => env?.cleanup());

const MIB = 1024 * 1024;
const TOTAL = 256 * MIB;

describe("deliverable upload streaming", () => {
  it(
    "streams a 256 MiB synthetic file to disk without holding it in memory",
    async () => {
      env = await setup();
      await env.createProject();
      const expected = createHash("sha256");
      let sent = 0;
      let peak = 0;
      const sample = () => {
        const m = process.memoryUsage();
        peak = Math.max(peak, m.heapUsed + m.arrayBuffers);
      };
      globalThis.gc?.();
      sample();
      const baseline = peak;
      const source = new ReadableStream<Uint8Array>({
        pull(c) {
          if (sent >= TOTAL) return c.close();
          // A fresh chunk each time, as a socket would deliver; the server must let it go.
          const chunk = new Uint8Array(MIB);
          if (sent === 0) chunk.set(SAMPLES.mp4.subarray(0, 64));
          else chunk.fill(sent / MIB);
          expected.update(chunk);
          sent += chunk.byteLength;
          sample();
          c.enqueue(chunk);
        },
      });

      const r = await env.upload(source, { title: "video", filename: "big.mp4" });
      expect(r.status).toBe(201);
      const d = Deliverable.parse(await r.json());
      expect(d.sizeBytes).toBe(TOTAL);
      expect(d.sha256).toBe(expected.digest("hex"));
      expect(statSync(env.files.pathFor("demo", d.id)).size).toBe(TOTAL);
      // Buffering the body would add >= 256 MiB; GC lag on fresh chunks stays far below that.
      expect(peak - baseline).toBeLessThan(96 * MIB);
    },
    120_000,
  );
});
