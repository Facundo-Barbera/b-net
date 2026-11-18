import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { toRequest } from "../src/serve.ts";

/** Stand-in for node:http's IncomingMessage: a readable stream plus the request line and raw headers. */
function incoming(method: string, chunks: Buffer[]): IncomingMessage {
  return Object.assign(Readable.from(chunks), {
    method,
    url: "/api/v1/projects/demo/deliverables?title=x",
    rawHeaders: ["Authorization", "Bearer placeholder", "Content-Type", "application/octet-stream"],
  }) as unknown as IncomingMessage;
}

describe("node:http -> Fetch Request adapter", () => {
  it("passes POST bodies through as a stream, chunk by chunk", async () => {
    const req = toRequest(incoming("POST", [Buffer.from("ab"), Buffer.from("cd")]), "100.64.0.10:8780");
    expect(req.method).toBe("POST");
    expect(req.url).toBe("http://100.64.0.10:8780/api/v1/projects/demo/deliverables?title=x");
    expect(req.headers.get("authorization")).toBe("Bearer placeholder");
    const reader = req.body!.getReader();
    const seen: string[] = [];
    for (let r = await reader.read(); !r.done; r = await reader.read()) seen.push(Buffer.from(r.value).toString());
    expect(seen.join("")).toBe("abcd");
  });

  it("GET requests carry no body", () => {
    expect(toRequest(incoming("GET", []), "100.64.0.10:8780").body).toBeNull();
  });
});
