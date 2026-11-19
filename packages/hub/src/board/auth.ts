/**
 * Who a Board request is. Two kinds of caller, nothing else:
 *
 * - A bot: `Authorization: Bearer bnet_board_…`, a token the hub stores only as a hash. It becomes the
 *   principal `bnet:bot:<name>` with kind "person", because Board only applies grants to a host's
 *   principals of that kind (it matches them by the id's third segment). People get Board's g1
 *   (everything), so a bot is let in only once its own grant, which closes `*` and opens its projects,
 *   is confirmed in this process (`isBotReady`). Until then its token answers 401: fail closed.
 * - Facundo: the `Tailscale-User-Login` that `tailscale serve` sets, if the login is in the admin
 *   allowlist. The header is never read here directly: the node adapter (serve.ts) deletes every
 *   identity header from every request and re-adds TRUSTED_LOGIN_HEADER only for a request that came
 *   through the 127.0.0.1 listener, from a loopback address, for the board's public host. A request to
 *   the tailnet IP listener can carry any header it likes and still names no one.
 */
import { HttpError } from "@vercel/board";
import type { CallerRequest } from "@vercel/board/access";
import { TRUSTED_LOGIN_HEADER } from "./identity.ts";

export const botPrincipalId = (bot: string) => `bnet:bot:${bot}`;

export interface AuthDeps {
  admins: ReadonlySet<string>;
  botForToken: (token: string) => string | null;
  /** True once the bot is in the config AND its narrowing grant is in place. */
  isBotReady: (bot: string) => boolean;
}

export type HostPrincipal = { id: string; kind: "person"; handle: string };

/** Board's `authenticate`. Null = no credential (Board answers 401); a bad one throws 401/403. */
export function createAuthenticate(deps: AuthDeps): (request: CallerRequest) => HostPrincipal | null {
  return (request) => {
    if (request.credential) {
      const bot = deps.botForToken(request.credential);
      // Same answer for unknown, revoked and not-yet-granted, so a token's state is not observable.
      if (!bot || !deps.isBotReady(bot)) throw new HttpError(401, "unauthorized", "unknown or revoked token");
      return { id: botPrincipalId(bot), kind: "person", handle: bot };
    }
    const login = request.headers.get(TRUSTED_LOGIN_HEADER);
    if (login) {
      if (!deps.admins.has(login.toLowerCase())) throw new HttpError(403, "forbidden", "this tailnet login is not a b-net admin");
      return { id: `tailscale:user:${login}`, kind: "person", handle: login.split("@")[0] || login };
    }
    return null;
  };
}
