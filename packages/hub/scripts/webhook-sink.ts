/**
 * Local test receiver for the hub's bot webhooks: the default target when a bot has no webhook of its
 * own (http://127.0.0.1:8799/bnet-webhook). It prints one line per delivery (id, attempt, kind, project,
 * signature check) and never the body's secrets, because there are none: summaries only.
 *
 *   node packages/hub/scripts/webhook-sink.ts                 # 127.0.0.1:8799, accepts everything
 *   WEBHOOK_SINK_FAIL=3 node …/webhook-sink.ts                # answers 503 to the first 3 requests (tests retries)
 *   WEBHOOK_SINK_SECRET_FILE=/path node …/webhook-sink.ts     # also checks x-bnet-signature
 *
 * Listens on 127.0.0.1 only. For tests and the orchestrator's checks, not for production.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { BnetWebhookBody } from "@b-net/core";

const port = Number(process.env.WEBHOOK_SINK_PORT || 8799);
let failFirst = Number(process.env.WEBHOOK_SINK_FAIL || 0);
const secret = process.env.WEBHOOK_SINK_SECRET_FILE ? readFileSync(process.env.WEBHOOK_SINK_SECRET_FILE, "utf8").trim() : null;
const seen = new Set<string>();

function signatureOk(ts: string | undefined, sig: string | undefined, body: string): boolean | null {
  if (!secret) return null;
  if (!ts || !sig) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`);
  const got = Buffer.from(sig);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

createServer((req, res) => {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (c: Buffer) => {
    size += c.length;
    if (size <= 64 * 1024) chunks.push(c);
  });
  req.on("end", () => {
    if (req.method !== "POST" || req.url !== "/bnet-webhook") return void res.writeHead(404).end();
    const body = Buffer.concat(chunks).toString("utf8");
    const id = String(req.headers["x-bnet-delivery"] ?? "?");
    const attempt = String(req.headers["x-bnet-attempt"] ?? "?");
    if (failFirst > 0) {
      failFirst--;
      console.log(`503 ${id} attempt ${attempt} (forced failure, ${failFirst} left)`);
      return void res.writeHead(503).end();
    }
    let parsed: BnetWebhookBody | null = null;
    try {
      const r = BnetWebhookBody.safeParse(JSON.parse(body));
      parsed = r.success ? r.data : null;
    } catch {
      parsed = null;
    }
    const sig = signatureOk(req.headers["x-bnet-timestamp"] as string | undefined, req.headers["x-bnet-signature"] as string | undefined, body);
    const dup = seen.has(id);
    seen.add(id);
    console.log(
      `${parsed ? "200" : "400"} ${id} attempt ${attempt}${parsed ? ` ${parsed.event.kind} ${parsed.event.project}` : " invalid body"}` +
        `${sig === null ? "" : sig ? " signature ok" : " SIGNATURE BAD"}${dup ? " (repeat: receiver dedupes on the id)" : ""}`,
    );
    res.writeHead(parsed ? 200 : 400).end();
  });
}).listen(port, "127.0.0.1", () => console.log(`webhook sink on http://127.0.0.1:${port}/bnet-webhook`));
