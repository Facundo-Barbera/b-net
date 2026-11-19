import { afterEach, describe, expect, it } from "vitest";
import { createBoardAuthenticate, PEER_MARK_HEADER, botScope, type BoardAuthenticate } from "../src/board/auth.ts";
import { SqliteBoardTokenStore, hashBoardToken } from "../src/board/tokens.ts";
import { ConfigError, parseBoardAdmins } from "../src/config.ts";

const URL_ = "http://hub.invalid/api/board/channels";
const TAILSCALE = "127.0.0.1";
const DIRECT = "100.64.0.20";

let store: SqliteBoardTokenStore;
afterEach(() => store?.close());

function setup(projects: Record<string, string[]> = { "bot-a": ["alpha", "beta"] }) {
  store = new SqliteBoardTokenStore(":memory:");
  const auth = createBoardAuthenticate({
    admins: ["Admin@Example.invalid"],
    botForToken: (t) => store.botForToken(t),
    projectsOfBot: (bot) => projects[bot] ?? [],
  });
  return auth;
}

/** What Board hands `authenticate`: the bearer token it parsed, and the headers. */
function asBoard(auth: BoardAuthenticate, request: Request) {
  const credential = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
  return auth({ credential, headers: request.headers });
}

const req = (headers: Record<string, string>, init: RequestInit = {}) => new Request(URL_, { ...init, headers });

async function status(result: unknown) {
  expect(result).toBeInstanceOf(Response);
  return (result as Response).status;
}

describe("Board authenticate: admin", () => {
  it("lets in an allowlisted login that came through tailscale serve", () => {
    const auth = setup();
    const r = auth.prepare(req({ "tailscale-user-login": "admin@example.invalid" }), TAILSCALE);
    expect(asBoard(auth, r)).toEqual({ id: "tailscale:user:admin@example.invalid", kind: "person", handle: "admin" });
  });

  it("compares logins without case", () => {
    const auth = setup();
    const r = auth.prepare(req({ "tailscale-user-login": "ADMIN@example.invalid" }), "::ffff:127.0.0.1");
    expect(asBoard(auth, r)).toMatchObject({ kind: "person", id: "tailscale:user:admin@example.invalid" });
  });

  it("ignores the login header when the caller reached the hub directly", async () => {
    const auth = setup();
    const r = auth.prepare(req({ "tailscale-user-login": "admin@example.invalid" }), DIRECT);
    expect(r.headers.has("tailscale-user-login")).toBe(false);
    expect(await status(asBoard(auth, r))).toBe(401);
  });

  it("ignores a forged proxy mark from a direct caller", async () => {
    const auth = setup();
    const r = auth.prepare(req({ "tailscale-user-login": "admin@example.invalid", [PEER_MARK_HEADER]: "guess" }), DIRECT);
    expect(r.headers.has(PEER_MARK_HEADER)).toBe(false);
    expect(await status(asBoard(auth, r))).toBe(401);
  });

  it("fails closed when the mount skips prepare", async () => {
    const auth = setup();
    expect(await status(asBoard(auth, req({ "tailscale-user-login": "admin@example.invalid" })))).toBe(401);
  });

  it("refuses a login outside the allowlist, even through tailscale serve", async () => {
    const auth = setup();
    const r = auth.prepare(req({ "tailscale-user-login": "other@example.invalid" }), TAILSCALE);
    expect(await status(asBoard(auth, r))).toBe(401);
  });

  it("refuses an unknown or unpeered address", async () => {
    const auth = setup();
    const r = auth.prepare(req({ "tailscale-user-login": "admin@example.invalid" }), undefined);
    expect(await status(asBoard(auth, r))).toBe(401);
  });
});

describe("Board authenticate: bots", () => {
  it("maps a bot token to its own principal, scoped to its project channels", () => {
    const auth = setup();
    const token = store.issue("bot-a");
    const r = auth.prepare(req({ authorization: `Bearer ${token}` }), DIRECT);
    expect(r.headers.get("x-board-can")).toBe("alpha/=read,post,react,label;beta/=read,post,react,label");
    expect(asBoard(auth, r)).toEqual({ id: "bnet:bot:bot-a", kind: "person", handle: "bot-a" });
  });

  it("overwrites the scope a bot sends for itself", () => {
    const auth = setup();
    const token = store.issue("bot-a");
    const r = auth.prepare(req({ authorization: `Bearer ${token}`, "x-board-can": "*=all" }), DIRECT);
    expect(r.headers.get("x-board-can")).toBe(botScope(["alpha/", "beta/"]));
    expect(asBoard(auth, r)).toMatchObject({ id: "bnet:bot:bot-a" });
  });

  it("refuses a bot request whose scope the hub did not set", async () => {
    const auth = setup();
    const token = store.issue("bot-a");
    expect(await status(asBoard(auth, req({ authorization: `Bearer ${token}` })))).toBe(403);
    expect(await status(asBoard(auth, req({ authorization: `Bearer ${token}`, "x-board-can": "*=all" })))).toBe(403);
  });

  it("prefers the bearer token over a login tailscale serve adds", () => {
    const auth = setup();
    const token = store.issue("bot-a");
    const r = auth.prepare(req({ authorization: `Bearer ${token}`, "tailscale-user-login": "admin@example.invalid" }), TAILSCALE);
    expect(asBoard(auth, r)).toMatchObject({ id: "bnet:bot:bot-a" });
  });

  it("refuses an unknown token with 401, even with an admin login beside it", async () => {
    const auth = setup();
    const r = auth.prepare(req({ authorization: "Bearer bnet_board_nope", "tailscale-user-login": "admin@example.invalid" }), TAILSCALE);
    expect(await status(asBoard(auth, r))).toBe(401);
  });

  it("refuses a bot that owns no project with 403", async () => {
    const auth = setup();
    const token = store.issue("bot-b");
    expect(await status(asBoard(auth, auth.prepare(req({ authorization: `Bearer ${token}` }), DIRECT)))).toBe(403);
  });

  it("stops a revoked or rotated token at the next request", async () => {
    const auth = setup();
    const first = store.issue("bot-a");
    const second = store.issue("bot-a");
    expect(await status(asBoard(auth, auth.prepare(req({ authorization: `Bearer ${first}` }), DIRECT)))).toBe(401);
    expect(asBoard(auth, auth.prepare(req({ authorization: `Bearer ${second}` }), DIRECT))).toMatchObject({ handle: "bot-a" });
    store.revoke("bot-a");
    expect(await status(asBoard(auth, auth.prepare(req({ authorization: `Bearer ${second}` }), DIRECT)))).toBe(401);
  });

  it("keeps the body when it rewrites headers", async () => {
    const auth = setup();
    const token = store.issue("bot-a");
    const r = auth.prepare(req({ authorization: `Bearer ${token}`, "content-type": "application/json" }, { method: "POST", body: '{"text":"hola"}' }), DIRECT);
    expect(r.method).toBe("POST");
    expect(await r.text()).toBe('{"text":"hola"}');
  });
});

describe("Board authenticate: nobody else", () => {
  it("answers 401 to a request with no credential", async () => {
    const auth = setup();
    expect(await status(asBoard(auth, auth.prepare(req({}), DIRECT)))).toBe(401);
    expect(await status(asBoard(auth, auth.prepare(req({}), TAILSCALE)))).toBe(401);
  });
});

describe("Board token store", () => {
  it("keeps only the hash and lists bots without tokens", () => {
    store = new SqliteBoardTokenStore(":memory:");
    const token = store.issue("bot-a", new Date("2026-11-19T00:00:00Z"));
    expect(token).toMatch(/^bnet_board_[A-Za-z0-9_-]{43}$/);
    expect(store.botForToken(token)).toBe("bot-a");
    expect(store.botForToken(hashBoardToken(token))).toBeNull();
    expect(store.list()).toEqual([{ bot: "bot-a", createdAt: "2026-11-19T00:00:00.000Z" }]);
    expect(store.revoke("bot-a")).toBe(true);
    expect(store.revoke("bot-a")).toBe(false);
    expect(store.list()).toEqual([]);
  });
});

describe("HUB_BOARD_ADMINS", () => {
  it("parses a comma list, lowercased and deduplicated", () => {
    expect(parseBoardAdmins(" Admin@example.invalid, admin@example.invalid,b@x.invalid ")).toEqual(["admin@example.invalid", "b@x.invalid"]);
    expect(parseBoardAdmins(undefined)).toEqual([]);
  });

  it("rejects a login Board can't keep", () => {
    expect(() => parseBoardAdmins("a+b@example.invalid")).toThrow(ConfigError);
    expect(() => parseBoardAdmins("no-at-sign")).toThrow(ConfigError);
  });
});
