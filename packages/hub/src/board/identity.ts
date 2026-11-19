/**
 * Identity headers on the way into the hub. The node adapter (serve.ts) deletes every identity header
 * from every request and re-adds TRUSTED_LOGIN_HEADER only for a request that came through the
 * 127.0.0.1 listener `tailscale serve` targets, from a loopback address, for the board's public host.
 * Kept free of @vercel/board so the plain HTTP handler can use it.
 */

/** Set by the adapter only; any copy a client sends is deleted before the handler sees the request. */
export const TRUSTED_LOGIN_HEADER = "x-bnet-tailnet-login";

/** Identity headers no client may set: Tailscale's own and ours. */
const IDENTITY_HEADERS = ["tailscale-user-login", "tailscale-user-name", "tailscale-user-profile-pic", TRUSTED_LOGIN_HEADER];

const LOGIN_RE = /^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,190}$/;

export const isLoopback = (addr: string | undefined) => addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";

export interface ArrivedVia {
  /** The request came in on the 127.0.0.1 listener that `tailscale serve` targets. */
  loopbackListener: boolean;
  remoteAddress: string | undefined;
  /** The request's Host header. */
  host: string | null;
  /** The board URL's host; null when the board is off. */
  publicHost: string | null;
}

/**
 * Strips identity headers and, only for a request `tailscale serve` forwarded, keeps the login under
 * TRUSTED_LOGIN_HEADER. Mutates `headers`. Pure apart from that, so it is tested without sockets.
 */
export function scrubIdentityHeaders(headers: Headers, via: ArrivedVia): void {
  const login = headers.get("tailscale-user-login");
  for (const h of IDENTITY_HEADERS) headers.delete(h);
  const trusted = via.loopbackListener && isLoopback(via.remoteAddress) && via.publicHost !== null && via.host === via.publicHost;
  if (trusted && login && LOGIN_RE.test(login)) headers.set(TRUSTED_LOGIN_HEADER, login);
}

/** The trusted admin login on an already-scrubbed request, or null. */
export function trustedLogin(headers: Headers, admins: ReadonlySet<string>): string | null {
  const login = headers.get(TRUSTED_LOGIN_HEADER);
  return login && admins.has(login.toLowerCase()) ? login : null;
}
