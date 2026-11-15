/**
 * Typed, read-only access to the local tailscaled: `tailscale status --json` and pings,
 * either through the CLI (injected execFile) or the LocalAPI (injected HTTP over unix socket).
 *
 * Field names follow tailscale's ipnstate.Status / PeerStatus / PingResult (Go JSON, PascalCase).
 * Schemas are loose (unknown fields pass through) and most fields optional, so new tailscale
 * versions don't break parsing.
 */
import { z } from "zod";
import type { LinkPath, TailscaleLink } from "../../contracts/machines.ts";

/* ------------------------------------------------------------------ *
 * Raw schemas
 * ------------------------------------------------------------------ */

export const TailscalePeer = z.looseObject({
  ID: z.string().optional(),
  PublicKey: z.string().optional(),
  HostName: z.string(),
  DNSName: z.string().optional(),
  OS: z.string().optional(),
  TailscaleIPs: z.array(z.string()).nullish(),
  /** Home DERP region code, e.g. "mia". */
  Relay: z.string().optional(),
  /** Peer relay endpoint when traffic goes through a tailscale peer relay. */
  PeerRelay: z.string().optional(),
  /** Current direct endpoint "ip:port"; empty when not direct. */
  CurAddr: z.string().optional(),
  Online: z.boolean().optional(),
  Active: z.boolean().optional(),
  LastSeen: z.string().optional(),
  LastHandshake: z.string().optional(),
  ExitNode: z.boolean().optional(),
  RxBytes: z.number().optional(),
  TxBytes: z.number().optional(),
});
export type TailscalePeer = z.infer<typeof TailscalePeer>;

export const TailscaleStatus = z.looseObject({
  Version: z.string().optional(),
  BackendState: z.string().optional(),
  Self: TailscalePeer,
  Peer: z.record(z.string(), TailscalePeer).nullish(),
  MagicDNSSuffix: z.string().optional(),
});
export type TailscaleStatus = z.infer<typeof TailscaleStatus>;

/** ipnstate.PingResult as returned by LocalAPI /localapi/v0/ping. */
export const TailscalePingResult = z.looseObject({
  IP: z.string().optional(),
  NodeIP: z.string().optional(),
  NodeName: z.string().optional(),
  Err: z.string().optional(),
  LatencySeconds: z.number().optional(),
  /** Direct endpoint "ip:port" when the pong came directly. */
  Endpoint: z.string().optional(),
  PeerRelay: z.string().optional(),
  DERPRegionID: z.number().optional(),
  DERPRegionCode: z.string().optional(),
  PeerAPIPort: z.number().optional(),
  IsLocalIP: z.boolean().optional(),
});
export type TailscalePingResult = z.infer<typeof TailscalePingResult>;

/* ------------------------------------------------------------------ *
 * Normalized ping
 * ------------------------------------------------------------------ */

export interface PingOutcome {
  ok: boolean;
  latencyMs: number | null;
  path: LinkPath;
  /** DERP region code when path = derp. */
  relay: string | null;
  error: string | null;
}

export function pingFromLocalApi(r: TailscalePingResult): PingOutcome {
  if (r.Err) return { ok: false, latencyMs: null, path: "unknown", relay: null, error: r.Err };
  const latencyMs = r.LatencySeconds === undefined ? null : round1(r.LatencySeconds * 1000);
  if (r.IsLocalIP) return { ok: true, latencyMs: 0, path: "self", relay: null, error: null };
  if (r.PeerRelay) return { ok: true, latencyMs, path: "peer-relay", relay: null, error: null };
  if (r.Endpoint) return { ok: true, latencyMs, path: "direct", relay: null, error: null };
  if (r.DERPRegionCode || r.DERPRegionID) return { ok: true, latencyMs, path: "derp", relay: r.DERPRegionCode || null, error: null };
  return { ok: true, latencyMs, path: "unknown", relay: null, error: null };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function durationToMs(value: string, unit: string): number {
  const v = Number(value);
  switch (unit) {
    case "s":
      return v * 1000;
    case "µs":
    case "us":
      return v / 1000;
    case "ns":
      return v / 1e6;
    default:
      return v;
  }
}

/**
 * Parse the output of `tailscale ping` (CLI). Uses the LAST pong line. Recognized:
 *   pong from host (100.64.0.40) via DERP(mia) in 87ms
 *   pong from host (100.64.0.20) via 203.0.113.7:41641 in 5ms
 *   pong from host (100.64.0.60) via peer-relay(198.51.100.9:7777:vni:3) in 34ms
 *   pong from host (100.64.0.20, 12345) via TSMP in 4ms
 */
export function parseCliPing(output: string): PingOutcome {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const re = /^pong from (\S+) \(([^)]*)\) via (.+?) in ([\d.]+)(ms|s|µs|us|ns)$/;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    const via = m[3]!;
    const latencyMs = round1(durationToMs(m[4]!, m[5]!));
    const derp = /^DERP\(([^)]+)\)$/i.exec(via);
    if (derp) return { ok: true, latencyMs, path: "derp", relay: derp[1]!, error: null };
    if (/^peer-?relay/i.test(via)) return { ok: true, latencyMs, path: "peer-relay", relay: null, error: null };
    if (/^TSMP$/i.test(via)) return { ok: true, latencyMs, path: "unknown", relay: null, error: null };
    // ip:port or [ipv6]:port
    if (/^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]):\d+$/i.test(via)) return { ok: true, latencyMs, path: "direct", relay: null, error: null };
    return { ok: true, latencyMs, path: "unknown", relay: null, error: null };
  }
  const last = lines.at(-1) ?? "no output";
  return { ok: false, latencyMs: null, path: "unknown", relay: null, error: last.slice(0, 200) };
}

/* ------------------------------------------------------------------ *
 * Derivations
 * ------------------------------------------------------------------ */

const ZERO_TIME = /^0001-01-01/;

export function tailscaleTimeToIso(s: string | undefined): string | null {
  if (!s || ZERO_TIME.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Path from status alone (no ping): CurAddr => direct, PeerRelay => peer-relay, Relay only => derp. */
export function linkPathFromStatus(peer: TailscalePeer, isSelf = false): { path: LinkPath; relay: string | null } {
  if (isSelf) return { path: "self", relay: null };
  if (!peer.Online) return { path: "unknown", relay: null };
  if (peer.CurAddr) return { path: "direct", relay: null };
  if (peer.PeerRelay) return { path: "peer-relay", relay: null };
  // Relay is the peer's home DERP; it's only the actual path while there is traffic and no direct addr.
  if (peer.Active && peer.Relay) return { path: "derp", relay: peer.Relay };
  return { path: "unknown", relay: null };
}

export function firstIPv4(ips: readonly string[] | null | undefined): string | null {
  return ips?.find((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) ?? ips?.[0] ?? null;
}

/** Combine a peer's status (and optional ping) into the contract's TailscaleLink. */
export function toTailscaleLink(peer: TailscalePeer, opts: { isSelf?: boolean; ping?: PingOutcome | null; now: string }): TailscaleLink {
  const isSelf = opts.isSelf ?? false;
  const online = isSelf ? true : (peer.Online ?? false);
  const fromStatus = linkPathFromStatus(peer, isSelf);
  const ping = opts.ping;
  const pinged = ping?.ok && !isSelf && ping.path !== "unknown";
  return {
    ip: firstIPv4(peer.TailscaleIPs),
    online,
    lastSeen: online ? opts.now : tailscaleTimeToIso(peer.LastSeen),
    latencyMs: isSelf ? 0 : ping?.ok ? ping.latencyMs : null,
    path: pinged ? ping!.path : fromStatus.path,
    relay: pinged ? ping!.relay : fromStatus.relay,
  };
}

/** Peers keyed by lowercase HostName, plus Self. */
export function indexByHostName(status: TailscaleStatus): Map<string, { peer: TailscalePeer; isSelf: boolean }> {
  const out = new Map<string, { peer: TailscalePeer; isSelf: boolean }>();
  for (const p of Object.values(status.Peer ?? {})) out.set(p.HostName.toLowerCase(), { peer: p, isSelf: false });
  out.set(status.Self.HostName.toLowerCase(), { peer: status.Self, isSelf: true });
  return out;
}

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

export class TailscaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailscaleError";
  }
}

export interface TailscaleSource {
  readonly kind: "cli" | "localapi";
  status(): Promise<TailscaleStatus>;
  ping(ip: string, opts?: { type?: "disco" | "TSMP"; timeoutMs?: number }): Promise<PingOutcome>;
}

export function parseStatusJson(raw: unknown): TailscaleStatus {
  const r = TailscaleStatus.safeParse(raw);
  if (!r.success) throw new TailscaleError(`tailscale status: unexpected shape (${r.error.issues[0]?.path.join(".") ?? "?"})`);
  return r.data;
}

/** Must NOT throw on non-zero exit (tailscale ping exits 1 when no direct path). */
export type ExecFn = (file: string, args: string[], opts: { timeoutMs: number }) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const IP_RE = /^[0-9a-fA-F.:]+$/;

export function createCliSource(opts: { exec: ExecFn; binary?: string; timeoutMs?: number }): TailscaleSource {
  const bin = opts.binary ?? "tailscale";
  const timeoutMs = opts.timeoutMs ?? 5000;
  return {
    kind: "cli",
    async status() {
      const r = await opts.exec(bin, ["status", "--json"], { timeoutMs });
      if (r.code !== 0) throw new TailscaleError(`tailscale status exited ${r.code}`);
      let json: unknown;
      try {
        json = JSON.parse(r.stdout);
      } catch {
        throw new TailscaleError("tailscale status: invalid JSON");
      }
      return parseStatusJson(json);
    },
    async ping(ip, p = {}) {
      if (!IP_RE.test(ip)) throw new TailscaleError("tailscale ping: invalid ip");
      const t = p.timeoutMs ?? 3000;
      const args = ["ping", "-c", "1", "--until-direct=false", `--timeout=${Math.ceil(t / 1000)}s`];
      if (p.type === "TSMP") args.push("--tsmp");
      args.push(ip);
      const r = await opts.exec(bin, args, { timeoutMs: t + 2000 });
      return parseCliPing(`${r.stdout}\n${r.stderr}`);
    },
  };
}

/** Minimal HTTP requester for the LocalAPI (injected; see unixSocketRequester). */
export type LocalApiRequest = (path: string, init: { method: "GET" | "POST"; timeoutMs: number }) => Promise<{ status: number; body: string }>;

export function createLocalApiSource(opts: { request: LocalApiRequest; timeoutMs?: number }): TailscaleSource {
  const timeoutMs = opts.timeoutMs ?? 5000;
  return {
    kind: "localapi",
    async status() {
      const r = await opts.request("/localapi/v0/status", { method: "GET", timeoutMs });
      if (r.status !== 200) throw new TailscaleError(`localapi status: HTTP ${r.status}`);
      return parseStatusJson(JSON.parse(r.body));
    },
    async ping(ip, p = {}) {
      if (!IP_RE.test(ip)) throw new TailscaleError("tailscale ping: invalid ip");
      const t = p.timeoutMs ?? 3000;
      const q = new URLSearchParams({ ip, type: p.type ?? "disco" });
      const r = await opts.request(`/localapi/v0/ping?${q}`, { method: "POST", timeoutMs: t });
      if (r.status !== 200) return { ok: false, latencyMs: null, path: "unknown", relay: null, error: `HTTP ${r.status}` };
      const parsed = TailscalePingResult.safeParse(JSON.parse(r.body));
      if (!parsed.success) return { ok: false, latencyMs: null, path: "unknown", relay: null, error: "unexpected ping shape" };
      return pingFromLocalApi(parsed.data);
    },
  };
}

/**
 * Real LocalAPI requester over tailscaled's unix socket. Not exercised in tests
 * (no sockets on the dev machine); tests inject a fake LocalApiRequest.
 */
export function unixSocketRequester(socketPath: string): LocalApiRequest {
  return async (path, init) => {
    const http = await import("node:http");
    return new Promise((resolve, reject) => {
      const req = http.request(
        { socketPath, path, method: init.method, headers: { host: "local-tailscaled.sock" }, timeout: init.timeoutMs },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new TailscaleError("localapi timeout")));
      req.on("error", reject);
      req.end();
    });
  };
}
