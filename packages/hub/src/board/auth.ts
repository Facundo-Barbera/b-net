/**
 * Who may use the Board mounted in the hub, as `board({ authenticate })` of @vercel/board 0.52.0
 * expects it: Facundo by his Tailscale login, and each bot by its own token, limited to the
 * channels of its projects. Anyone else gets a 401.
 *
 * Two facts about Board shape this file:
 * - Its `authenticate` sees the request's headers and bearer token, never the TCP peer. So the
 *   hub must pass every request through `prepare(request, remoteAddress)` before `team.fetch`:
 *   that is where the peer is known. `prepare` marks requests from tailscale serve with a
 *   per-process secret, and `authenticate` trusts `Tailscale-User-Login` only with that mark,
 *   so a mount that forgets `prepare` locks Facundo out instead of letting anyone claim his login.
 * - A host's principal that isn't a `person` gets nothing from Board unless it is a Vercel
 *   deployment, and a host's principal carries no scope of its own. So bots are `person`s, and
 *   what keeps them in their channels is the `x-board-can` header, which Board applies on top of
 *   any principal. `prepare` overwrites it with the bot's channels and `authenticate` refuses a
 *   bot request whose header says anything else, so a bot can't widen it.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { BoardPrincipal } from "@b-net/core";

/** The part of Board's `CallerRequest` this verifier reads. Structural, so the hub needs no Board import here. */
export interface BoardCallerRequest {
  /** The bearer token, or null. */
  credential: string | null;
  headers: Headers;
}

/** Board's `HostPrincipal`: an id in its `scheme:kind:value` form, a kind and a handle. */
export interface BoardHostPrincipal {
  id: string;
  kind: "person";
  handle: string;
}

export type BoardAuthenticate = ((request: BoardCallerRequest) => BoardHostPrincipal | Response | null) & {
  /** Rewrites the request's trust headers from its TCP peer. Call it on every request before `team.fetch`. */
  prepare(request: Request, remoteAddress: string | undefined): Request;
};

export interface BoardAuthOptions {
  /** Tailscale logins allowed in as admin (HUB_BOARD_ADMINS). Compared lowercase. */
  admins: readonly string[];
  /** The bot a raw token belongs to, or null (SqliteBoardTokenStore#botForToken). */
  botForToken(token: string): string | null;
  /** Slugs of the projects the bot owns (Project.ownerBot). Read per request, so reassignments apply at once. */
  projectsOfBot(bot: string): readonly string[];
  /** Fixed mark secret, for tests only; by default a fresh random one per process. */
  peerSecret?: string;
}

const TS_LOGIN = "tailscale-user-login";
/** Every header tailscale serve sets about the caller: all are dropped unless it is the one sending them. */
const TS_HEADERS = [TS_LOGIN, "tailscale-user-name", "tailscale-user-profile-pic", "tailscale-headers-info"];
/** Hub-internal mark: "this request came through tailscale serve". Never accepted from outside. */
export const PEER_MARK_HEADER = "x-bnet-board-peer";
const CAN_HEADER = "x-board-can";
/** Board refuses an x-board-can longer than this (CAN_MAX in @vercel/board/access). */
const CAN_MAX = 4000;

/** What a bot may do in its channels: everything a worker needs, never `sync` (speak as others) or `manage` (grants). */
export const BOT_PERMISSIONS = ["read", "post", "react", "label"] as const;

/** tailscale serve proxies from loopback; the hub's own listener is on the Tailscale IP, so a direct caller never is. */
const PROXY_PEERS = new Set(["127.0.0.1", "::ffff:127.0.0.1"]);

/** A Tailscale login Board can keep as an id: no `+`, nothing outside letters, digits, `.`, `_`, `-` and one `@`. */
export const TAILSCALE_LOGIN = /^[a-z0-9._-]+@[a-z0-9._-]+$/;

/** The bot's channels, one subtree per project it owns. */
export const botChannels = (slugs: readonly string[]) => [...new Set(slugs)].sort().map((slug) => `${slug}/`);

/** The x-board-can that confines a bot to its channels, `a/=read,post,react,label;b/=…`. */
export const botScope = (channels: readonly string[]) => channels.map((c) => `${c}=${BOT_PERMISSIONS.join(",")}`).join(";");

const bearerOf = (headers: Headers): string | null => /^Bearer\s+(\S+)\s*$/i.exec(headers.get("authorization") ?? "")?.[1] ?? null;

function sameSecret(a: string | null, b: string): boolean {
  if (a === null) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const deny = (status: 401 | 403, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: status === 401 ? { "www-authenticate": "Bearer" } : {} });

export function createBoardAuthenticate(opts: BoardAuthOptions): BoardAuthenticate {
  const admins = new Set(opts.admins.map((a) => a.trim().toLowerCase()).filter(Boolean));
  const secret = opts.peerSecret ?? randomBytes(32).toString("base64url");

  /** Who the request is, in the shared contract's terms; a Response for one Board must refuse. */
  function principalOf(request: BoardCallerRequest): BoardPrincipal | Response {
    // A bearer token decides even when tailscale serve also names a login: a bot on one of
    // Facundo's machines reaches the hub as him, and must still get only its own channels.
    const token = request.credential;
    if (token !== null) {
      const bot = opts.botForToken(token);
      if (bot === null) return deny(401, "unauthorized", "token desconocido o revocado");
      const channels = botChannels(opts.projectsOfBot(bot));
      if (channels.length === 0) return deny(403, "forbidden", `el bot ${bot} no tiene proyectos asignados`);
      return { kind: "bot", bot, channels };
    }
    if (!sameSecret(request.headers.get(PEER_MARK_HEADER), secret)) return deny(401, "unauthorized", "falta autenticación");
    const login = request.headers.get(TS_LOGIN)?.trim().toLowerCase() ?? "";
    if (!TAILSCALE_LOGIN.test(login) || !admins.has(login)) return deny(401, "unauthorized", "este usuario de Tailscale no tiene acceso");
    return { kind: "admin", login };
  }

  const authenticate = ((request: BoardCallerRequest) => {
    const p = principalOf(request);
    if (p instanceof Response) return p;
    if (p.kind === "admin") return { id: `tailscale:user:${p.login}`, kind: "person", handle: p.login.split("@")[0]!.slice(0, 64) };
    const scope = botScope(p.channels);
    if (scope.length > CAN_MAX) return deny(403, "forbidden", `el bot ${p.bot} tiene demasiados proyectos para un solo token`);
    // Without prepare the header is missing or the bot's own: refuse rather than run unscoped.
    if (request.headers.get(CAN_HEADER) !== scope) return deny(403, "forbidden", "alcance del bot no aplicado por el hub");
    return { id: `bnet:bot:${p.bot}`, kind: "person", handle: p.bot };
  }) as BoardAuthenticate;

  authenticate.prepare = (request, remoteAddress) => {
    const headers = new Headers(request.headers);
    headers.delete(PEER_MARK_HEADER);
    const viaProxy = remoteAddress !== undefined && PROXY_PEERS.has(remoteAddress);
    if (viaProxy && headers.has(TS_LOGIN)) headers.set(PEER_MARK_HEADER, secret);
    else for (const h of TS_HEADERS) headers.delete(h);

    // A bot's scope is the hub's word, never its own: drop whatever it sent and set its channels.
    const token = bearerOf(headers);
    if (token !== null) {
      headers.delete(CAN_HEADER);
      const bot = opts.botForToken(token);
      if (bot !== null) {
        const channels = botChannels(opts.projectsOfBot(bot));
        if (channels.length > 0) headers.set(CAN_HEADER, botScope(channels));
      }
    }
    // duplex: Node's fetch needs it to carry a streamed body into the new Request.
    return new Request(request, { headers, duplex: "half" } as RequestInit);
  };

  return authenticate;
}
