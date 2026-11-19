import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { snapshotFixture } from "@b-net/core";
import type { BoardService } from "../src/board/service.ts";
import { SqliteBoardTokenStore } from "../src/board/tokens.ts";
import { createHandler } from "../src/http.ts";
import { boardAccess, toRequest, withBoardPeer, type PeerHandler } from "../src/serve.ts";
import { MemoryUsageStore } from "../src/store.ts";
import { BOARD_URL, catalogFixture, startEngine } from "./board-helpers.ts";

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

describe("Board access wired into the hub", () => {
  const PROXY = "127.0.0.1";
  const DIRECT = "100.64.0.20";
  const ADMIN = "admin@example.invalid";
  const project = (id: string, ownerBot: string) => ({ ...catalogFixture[0]!.project, id, name: id, ownerBot });

  let svc: BoardService | null = null;
  let tokens: SqliteBoardTokenStore | null = null;
  afterEach(async () => {
    await svc?.stop();
    tokens?.close();
    svc = null;
    tokens = null;
  });

  /** The same pieces serve.ts builds: token store, access, real local() board, hub handler, peer rewrite. */
  async function hub(): Promise<{ served: PeerHandler; tokens: SqliteBoardTokenStore }> {
    tokens = new SqliteBoardTokenStore(":memory:");
    const auth = boardAccess({ admins: [ADMIN], tokens, projects: () => [project("alpha", "bot-a"), project("beta", "bot-b")] });
    ({ svc } = await startEngine({ authenticate: auth }));
    // Channels exist before the bot writes, so a refusal below is the grant and not a missing channel.
    await svc.team.post("alpha/avances", "inicio");
    await svc.team.post("beta/avances", "inicio");
    const handler = createHandler({ snapshot: () => snapshotFixture, store: new MemoryUsageStore(), apiToken: "placeholder-api-token", board: svc });
    return { served: withBoardPeer(handler, auth), tokens };
  }

  const call = (path: string, headers: Record<string, string> = {}, body?: unknown) =>
    new Request(`${BOARD_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const principal = async (r: Response) => ((await r.json()) as { principal: string }).principal;

  it("still refuses every caller without credentials", async () => {
    const { served } = await hub();
    expect((await served(call("/me"), DIRECT)).status).toBe(401);
    expect((await served(call("/me"), PROXY)).status).toBe(401);
    expect((await served(call("/messages", {}, { channel: "alpha/avances", text: "x" }), DIRECT)).status).toBe(401);
    // The admin's login only counts when tailscale serve sent it; from any other peer it is dropped.
    expect((await served(call("/me", { "tailscale-user-login": ADMIN }), DIRECT)).status).toBe(401);
    expect((await served(call("/me", { "tailscale-user-login": ADMIN }), undefined)).status).toBe(401);
  });

  it("lets the admin in through the local proxy", async () => {
    const { served } = await hub();
    const me = await served(call("/me", { "tailscale-user-login": ADMIN }), PROXY);
    expect(me.status).toBe(200);
    expect(await principal(me)).toBe(`tailscale:user:${ADMIN}`);
    expect((await served(call("/me", { "tailscale-user-login": "other@example.invalid" }), PROXY)).status).toBe(401);
  });

  it("lets a bot token into its own project's channel and no other", async () => {
    const { served, tokens } = await hub();
    const auth = { authorization: `Bearer ${tokens.issue("bot-a")}` };
    const me = await served(call("/me", auth), DIRECT);
    expect(me.status).toBe(200);
    expect(await principal(me)).toBe("bnet:bot:bot-a");
    expect((await served(call("/messages", auth, { channel: "alpha/avances", text: "avance" }), DIRECT)).status).toBe(201);
    // Board may answer 403 or hide the channel with 404; either way the post must not land.
    expect([403, 404]).toContain((await served(call("/messages", auth, { channel: "beta/avances", text: "intruso" }), DIRECT)).status);
    // A scope the bot writes for itself is replaced by the hub's.
    const widened = await served(call("/messages", { ...auth, "x-board-can": "*=all" }, { channel: "beta/avances", text: "intruso" }), DIRECT);
    expect([403, 404]).toContain(widened.status);
    expect((await svc!.team.channel("beta/avances").messages()).messages.map((m) => m.text)).toEqual(["inicio"]);
    expect((await served(call("/me", { authorization: "Bearer bnet_board_desconocido" }), DIRECT)).status).toBe(401);
  });
});
