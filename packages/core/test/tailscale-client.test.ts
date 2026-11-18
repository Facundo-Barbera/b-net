import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TailscaleLink } from "../src/index.ts";
import {
  createCliSource, createLocalApiSource, indexByHostName, linkPathFromStatus, parseCliPing, parseStatusJson,
  pingFromLocalApi, toTailscaleLink, TailscalePingResult, type ExecFn, type LocalApiRequest,
} from "../src/clients/tailscale/index.ts";

const read = (p: string) => readFileSync(new URL(`./fixtures/tailscale/${p}`, import.meta.url), "utf8");
const statusText = read("status.json");
const pings = JSON.parse(read("ping-localapi.json")) as Record<string, unknown>;
const NOW = "2026-11-15T20:30:00.000Z";

describe("tailscale status parsing", () => {
  const status = parseStatusJson(JSON.parse(statusText));
  const idx = indexByHostName(status);

  it("indexes self and peers by lowercase hostname", () => {
    expect([...idx.keys()].sort()).toEqual(["bixku-homelab", "bixku-mba", "bixku-mbp", "bixku-mini-server", "bixku-pc", "bixku-vps", "phone-fake"]);
    expect(idx.get("bixku-homelab")!.isSelf).toBe(true);
  });

  it("derives link path from status", () => {
    const path = (h: string) => linkPathFromStatus(idx.get(h)!.peer, idx.get(h)!.isSelf);
    expect(path("bixku-homelab").path).toBe("self");
    expect(path("bixku-vps").path).toBe("direct");
    expect(path("bixku-pc")).toEqual({ path: "derp", relay: "mia" });
    expect(path("bixku-mba").path).toBe("peer-relay");
    expect(path("bixku-mbp").path).toBe("unknown");
  });

  it("builds TailscaleLink (zero LastSeen -> null, offline keeps LastSeen)", () => {
    const mbp = toTailscaleLink(idx.get("bixku-mbp")!.peer, { now: NOW });
    expect(mbp).toEqual({ ip: "100.64.0.50", online: false, lastSeen: "2026-11-14T18:30:00.000Z", latencyMs: null, path: "unknown", relay: null });
    const self = toTailscaleLink(status.Self, { isSelf: true, now: NOW });
    expect(self).toMatchObject({ ip: "100.64.0.10", latencyMs: 0, path: "self" });
    for (const { peer, isSelf } of idx.values()) expect(TailscaleLink.safeParse(toTailscaleLink(peer, { isSelf, now: NOW })).success).toBe(true);
  });

  it("rejects garbage", () => {
    expect(() => parseStatusJson({ nope: 1 })).toThrow(/unexpected shape/);
  });
});

describe("tailscale ping parsing", () => {
  it("parses CLI pong lines", () => {
    expect(parseCliPing(read("ping-cli.txt"))).toEqual({ ok: true, latencyMs: 87, path: "derp", relay: "mia", error: null });
    expect(parseCliPing("pong from bixku-vps (100.64.0.20) via 203.0.113.20:41641 in 5ms")).toMatchObject({ path: "direct", latencyMs: 5 });
    expect(parseCliPing("pong from a (100.64.0.60) via peer-relay(198.51.100.9:7777:vni:3) in 34ms")).toMatchObject({ path: "peer-relay", latencyMs: 34 });
    expect(parseCliPing("pong from a (100.64.0.20, 41641) via TSMP in 1.5s")).toMatchObject({ path: "unknown", latencyMs: 1500 });
    expect(parseCliPing("pong from a (100.64.0.20) via [2001:db8::1]:41641 in 850µs")).toMatchObject({ path: "direct", latencyMs: 0.9 });
    expect(parseCliPing("pong from x (100.64.0.40) via DERP(mia) in 90ms\npong from x (100.64.0.40) via 192.0.2.4:41641 in 9ms")).toMatchObject({ path: "direct", latencyMs: 9 });
  });

  it("reports failures", () => {
    const r = parseCliPing("ping \"100.64.0.50\" timed out\n");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timed out/);
    expect(parseCliPing("").ok).toBe(false);
  });

  it("maps LocalAPI PingResult", () => {
    expect(pingFromLocalApi(TailscalePingResult.parse(pings["bixku-vps"]))).toEqual({ ok: true, latencyMs: 148, path: "direct", relay: null, error: null });
    expect(pingFromLocalApi(TailscalePingResult.parse(pings["pc-bixku"]))).toMatchObject({ path: "derp", relay: "mia", latencyMs: 87 });
    expect(pingFromLocalApi(TailscalePingResult.parse(pings["bixku-mba"]))).toMatchObject({ path: "peer-relay", latencyMs: 34 });
    expect(pingFromLocalApi(TailscalePingResult.parse(pings["bixku-mbp"]))).toMatchObject({ ok: false, error: "timeout waiting for pong" });
    expect(pingFromLocalApi({ IsLocalIP: true })).toMatchObject({ path: "self", latencyMs: 0 });
  });
});

describe("tailscale sources", () => {
  it("cli source runs status/ping via injected exec", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (_f, args) => {
      calls.push(args);
      if (args[0] === "status") return { stdout: statusText, stderr: "", code: 0 };
      return { stdout: read("ping-cli.txt"), stderr: "direct connection not established\n", code: 1 };
    };
    const src = createCliSource({ exec });
    expect((await src.status()).Self.HostName).toBe("bixku-homelab");
    expect(await src.ping("100.64.0.40")).toMatchObject({ ok: true, path: "derp" });
    expect(calls[1]).toContain("--until-direct=false");
    await expect(src.ping("1.2.3.4; rm -rf /")).rejects.toThrow(/invalid ip/);
  });

  it("localapi source uses status and POST ping", async () => {
    const seen: string[] = [];
    const request: LocalApiRequest = async (path, init) => {
      seen.push(`${init.method} ${path}`);
      if (path === "/localapi/v0/status") return { status: 200, body: statusText };
      const ip = new URL(path, "http://x").searchParams.get("ip");
      const hit = Object.values(pings).find((p) => (p as { IP: string }).IP === ip);
      return { status: 200, body: JSON.stringify(hit) };
    };
    const src = createLocalApiSource({ request });
    expect(Object.keys((await src.status()).Peer ?? {})).toHaveLength(6);
    expect(await src.ping("100.64.0.20")).toMatchObject({ path: "direct", latencyMs: 148 });
    expect(seen[1]).toBe("POST /localapi/v0/ping?ip=100.64.0.20&type=disco");
  });
});
