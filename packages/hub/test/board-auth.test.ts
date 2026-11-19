import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { HubRoutes, snapshotFixture } from "@b-net/core";
import { createAuthenticate, resolvePrincipal, type AuthDeps } from "../src/board/auth.ts";
import { scrubIdentityHeaders, trustedLogin, TRUSTED_LOGIN_HEADER } from "../src/board/identity.ts";
import type { BoardService } from "../src/board/service.ts";
import { createHandler } from "../src/http.ts";
import { toRequest } from "../src/serve.ts";
import { MemoryUsageStore } from "../src/store.ts";
import { ADMIN, boardRequest, startService } from "./board-helpers.ts";

const PUBLIC_HOST = "bixku-homelab.tail0fake.ts.net";

describe("identity headers", () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it("keeps the Tailscale login only for tailscale serve: loopback listener, loopback peer, the board's host", () => {
    const h = headers({ "tailscale-user-login": ADMIN, "tailscale-user-name": "F", host: PUBLIC_HOST });
    scrubIdentityHeaders(h, { loopbackListener: true, remoteAddress: "127.0.0.1", host: PUBLIC_HOST, publicHost: PUBLIC_HOST });
    expect(h.get(TRUSTED_LOGIN_HEADER)).toBe(ADMIN);
    expect(h.get("tailscale-user-login")).toBeNull();
    expect(h.get("tailscale-user-name")).toBeNull();
  });

  it("drops it on the tailnet IP listener, from a non-loopback peer, for another host, or when the board is off", () => {
    const cases = [
      { loopbackListener: false, remoteAddress: "127.0.0.1", host: PUBLIC_HOST, publicHost: PUBLIC_HOST },
      { loopbackListener: true, remoteAddress: "100.64.0.20", host: PUBLIC_HOST, publicHost: PUBLIC_HOST },
      { loopbackListener: true, remoteAddress: "127.0.0.1", host: "127.0.0.1:8779", publicHost: PUBLIC_HOST },
      { loopbackListener: true, remoteAddress: "127.0.0.1", host: PUBLIC_HOST, publicHost: null },
    ];
    for (const via of cases) {
      const h = headers({ "tailscale-user-login": ADMIN });
      scrubIdentityHeaders(h, via);
      expect(h.get(TRUSTED_LOGIN_HEADER), JSON.stringify(via)).toBeNull();
    }
  });

  it("never lets a client set the trusted header itself", () => {
    const h = headers({ [TRUSTED_LOGIN_HEADER]: ADMIN });
    scrubIdentityHeaders(h, { loopbackListener: false, remoteAddress: "100.64.0.20", host: "100.64.0.10:8780", publicHost: PUBLIC_HOST });
    expect(h.get(TRUSTED_LOGIN_HEADER)).toBeNull();
    // Even through tailscale serve, a forged trusted header without Tailscale's own is dropped.
    const h2 = headers({ [TRUSTED_LOGIN_HEADER]: ADMIN, host: PUBLIC_HOST });
    scrubIdentityHeaders(h2, { loopbackListener: true, remoteAddress: "127.0.0.1", host: PUBLIC_HOST, publicHost: PUBLIC_HOST });
    expect(h2.get(TRUSTED_LOGIN_HEADER)).toBeNull();
  });

  it("is applied by the node adapter on every listener", () => {
    const incoming = (remoteAddress: string) =>
      Object.assign(Readable.from([]), {
        method: "GET",
        url: "/api/board/me",
        rawHeaders: ["Host", PUBLIC_HOST, "Tailscale-User-Login", ADMIN, "X-Bnet-Tailnet-Login", "someone@example.invalid"],
        socket: { remoteAddress },
      }) as unknown as IncomingMessage;
    const viaTailnet = toRequest(incoming("100.64.0.20"), "100.64.0.10:8780", { loopback: false, publicHost: PUBLIC_HOST });
    expect(viaTailnet.headers.get(TRUSTED_LOGIN_HEADER)).toBeNull();
    const viaServe = toRequest(incoming("127.0.0.1"), "127.0.0.1:8779", { loopback: true, publicHost: PUBLIC_HOST });
    expect(viaServe.headers.get(TRUSTED_LOGIN_HEADER)).toBe(ADMIN);
    expect(trustedLogin(viaServe.headers, new Set([ADMIN]))).toBe(ADMIN);
    expect(trustedLogin(viaServe.headers, new Set(["other@example.invalid"]))).toBeNull();
  });
});

describe("authenticate", () => {
  const deps: AuthDeps = {
    admins: new Set([ADMIN]),
    botForToken: (t) => ({ "tok-ready": "fstack-vps", "tok-locked": "ghost" })[t] ?? null,
    isBotReady: (b) => b === "fstack-vps",
    channelsOf: (b) => (b === "fstack-vps" ? ["b-net/"] : []),
  };
  const req = (credential: string | null, h: Record<string, string> = {}) => ({ credential, headers: new Headers(h) });

  it("maps a ready bot token to its BoardPrincipal and to a person principal for Board", () => {
    expect(resolvePrincipal(req("tok-ready"), deps)).toEqual({ kind: "bot", bot: "fstack-vps", channels: ["b-net/"] });
    expect(createAuthenticate(deps)({ ...req("tok-ready"), claims: { profile: null, avatar: null, scope: null }, audience: "x" })).toEqual({ id: "bnet:bot:fstack-vps", kind: "person", handle: "fstack-vps" });
  });

  it("answers the same 401 for unknown, revoked and not-yet-granted tokens", () => {
    for (const t of ["nope", "tok-locked"]) expect(() => resolvePrincipal(req(t), deps)).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("takes an allowlisted trusted login as admin, refuses others, and is null with no credential", () => {
    expect(resolvePrincipal(req(null, { [TRUSTED_LOGIN_HEADER]: "Facundo@Example.invalid" }), deps)).toEqual({ kind: "admin", login: "Facundo@Example.invalid" });
    expect(() => resolvePrincipal(req(null, { [TRUSTED_LOGIN_HEADER]: "intruso@example.invalid" }), deps)).toThrow(expect.objectContaining({ status: 403 }));
    // Tailscale's own header is never read here: only the adapter's trusted copy counts.
    expect(resolvePrincipal(req(null, { "tailscale-user-login": ADMIN }), deps)).toBeNull();
  });
});

describe("access on a real board", () => {
  let svc: BoardService | null = null;
  afterEach(async () => {
    await svc?.stop();
    svc = null;
  });

  const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

  it("lets a bot post in its project's channels and nowhere else", async () => {
    ({ svc } = await startService());
    const token = svc.tokens.issue("fstack-vps");
    const me = await svc.fetch(boardRequest("/me", { token }));
    expect(me.status).toBe(200);
    expect((await json(me)).principal).toBe("bnet:bot:fstack-vps");
    expect((await svc.fetch(boardRequest("/messages", { token, body: { channel: "b-net/avances", text: "avance" } }))).status).toBe(201);
    expect((await svc.fetch(boardRequest("/messages", { token, body: { channel: "bixku-bot/avances", text: "no" } }))).status).toBe(403);
    // It can't touch grants either: that takes manage at *.
    expect((await svc.fetch(boardRequest("/grants", { token }))).status).toBe(403);
  });

  it("refuses tokens of bots missing from the config and revoked tokens", async () => {
    ({ svc } = await startService());
    const ghost = svc.tokens.issue("ghost");
    expect((await svc.fetch(boardRequest("/me", { token: ghost }))).status).toBe(401);
    const token = svc.tokens.issue("fstack-vps");
    svc.tokens.revoke("fstack-vps");
    expect((await svc.fetch(boardRequest("/me", { token }))).status).toBe(401);
  });

  it("gives the admin everything, refuses other logins and anonymous callers", async () => {
    ({ svc } = await startService());
    const admin = await svc.fetch(boardRequest("/me", { login: ADMIN }));
    expect(admin.status).toBe(200);
    expect((await json(admin)).principal).toBe(`tailscale:user:${ADMIN}`);
    expect((await svc.fetch(boardRequest("/grants", { login: ADMIN }))).status).toBe(200);
    expect((await svc.fetch(boardRequest("/me", { login: "intruso@example.invalid" }))).status).toBe(403);
    expect((await svc.fetch(boardRequest("/me"))).status).toBe(401);
  });
});

describe("hub handler and the board", () => {
  const base = { snapshot: () => snapshotFixture, store: new MemoryUsageStore() };

  it("forwards every method under /api/board to Board, before the hub's own token check", async () => {
    const seen: string[] = [];
    const handler = createHandler({
      ...base,
      apiToken: "placeholder-api-token",
      board: { fetch: async (r) => (seen.push(`${r.method} ${new URL(r.url).pathname}`), new Response("{}", { status: 200 })), projects: async () => ({ projects: [], generatedAt: "2026-11-15T20:30:00.000Z" }) },
    });
    expect((await handler(new Request("http://hub.invalid/api/board/me"))).status).toBe(200);
    expect((await handler(new Request("http://hub.invalid/api/board/messages", { method: "POST", body: "{}" }))).status).toBe(200);
    expect(seen).toEqual(["GET /api/board/me", "POST /api/board/messages"]);
  });

  it("answers 404 under /api/board and 503 on the projects route when the hub has no board", async () => {
    const handler = createHandler(base);
    expect((await handler(new Request("http://hub.invalid/api/board/me"))).status).toBe(404);
    expect((await handler(new Request(`http://hub.invalid${HubRoutes.board}`))).status).toBe(503);
  });

  it("lets the trusted admin read /api/* without the hub token; others still need it", async () => {
    const handler = createHandler({ ...base, apiToken: "placeholder-api-token", admins: new Set([ADMIN]) });
    expect((await handler(new Request(`http://hub.invalid${HubRoutes.health}`, { headers: { [TRUSTED_LOGIN_HEADER]: ADMIN } }))).status).toBe(200);
    expect((await handler(new Request(`http://hub.invalid${HubRoutes.health}`, { headers: { [TRUSTED_LOGIN_HEADER]: "intruso@example.invalid" } }))).status).toBe(401);
    expect((await handler(new Request(`http://hub.invalid${HubRoutes.health}`))).status).toBe(401);
  });
});
