import { describe, expect, it } from "vitest";
import { AgentMetricsPush, IngestRoutes, type MachineMetrics } from "@b-net/core";
import { ConfigError, INGEST_PATH, loadPushConfig } from "../src/config.ts";
import { createPusher, type PostJson } from "../src/pusher.ts";

const TOKEN = "bnet_agent_placeholder-token-for-tests-only";
const metrics: MachineMetrics = {
  cpuPct: 12.5, memPct: 40, memUsedGb: 3.2, memTotalGb: 8, diskPct: 50, diskUsedGb: 50, diskTotalGb: 100,
  load1: 0.5, netRxBps: 1000, netTxBps: 500, uptimeSec: 3600, tempC: null,
};
const env = { AGENT_MACHINE_ID: "bixku-mbp", AGENT_HUB_URL: "http://hub.invalid:8780/", AGENT_TOKEN: TOKEN };

describe("loadPushConfig", () => {
  it("builds the ingest URL and defaults to 30 s", () => {
    expect(loadPushConfig(env, () => "")).toEqual({
      machineId: "bixku-mbp", token: TOKEN, ingestUrl: "http://hub.invalid:8780/ingest/v1/metrics", intervalSec: 30,
    });
  });

  it("reads the token file over AGENT_TOKEN and validates every field", () => {
    expect(loadPushConfig({ ...env, AGENT_TOKEN_FILE: "/t" }, () => `${TOKEN}-file\n`).token).toBe(`${TOKEN}-file`);
    expect(() => loadPushConfig({ ...env, AGENT_HUB_URL: "" }, () => "")).toThrow(ConfigError);
    expect(() => loadPushConfig({ ...env, AGENT_HUB_URL: "ftp://hub.invalid" }, () => "")).toThrow(ConfigError);
    expect(() => loadPushConfig({ ...env, AGENT_HUB_URL: "http://u:p@hub.invalid" }, () => "")).toThrow(ConfigError);
    expect(() => loadPushConfig({ ...env, AGENT_TOKEN: "short" }, () => "")).toThrow(ConfigError);
    expect(() => loadPushConfig({ ...env, AGENT_MACHINE_ID: "Bad Id" }, () => "")).toThrow(ConfigError);
    expect(() => loadPushConfig({ ...env, AGENT_INTERVAL_SEC: "1" }, () => "")).toThrow(ConfigError);
  });

  it("its ingest path matches the core contract (spelled out to keep zod out of the agent)", () => {
    expect(INGEST_PATH).toBe(IngestRoutes.metrics);
  });
});

describe("pusher", () => {
  const collector = { sample: async () => metrics };

  it("POSTs a body that validates against AgentMetricsPush, with the bearer token", async () => {
    const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const post: PostJson = async (url, headers, body) => (sent.push({ url, headers, body }), 204);
    const p = createPusher({ collector, post, ingestUrl: "http://hub.invalid/ingest/v1/metrics", machineId: "bixku-mbp", token: TOKEN, version: "0.2.0" });
    expect(await p.pushOnce()).toEqual({ ok: true });
    expect(sent[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(AgentMetricsPush.parse(JSON.parse(sent[0]!.body))).toEqual({ machineId: "bixku-mbp", agentVersion: "0.2.0", metrics });
  });

  it("logs only on state changes and never logs the token", async () => {
    const lines: string[] = [];
    let mode: "down" | "401" | "ok" = "down";
    const post: PostJson = async () => {
      if (mode === "down") throw Object.assign(new Error(`connect ECONNREFUSED ${TOKEN}`), { code: "ECONNREFUSED" });
      return mode === "401" ? 401 : 204;
    };
    const p = createPusher({ collector, post, ingestUrl: "http://hub.invalid/x", machineId: "m", token: TOKEN, version: "0", log: (l) => lines.push(l) });
    for (let i = 0; i < 3; i++) await p.pushOnce();
    mode = "401";
    expect(await p.pushOnce()).toEqual({ ok: false, reason: "HTTP 401" });
    await p.pushOnce();
    mode = "ok";
    await p.pushOnce();
    await p.pushOnce();
    expect(lines).toEqual(["push failing: ECONNREFUSED", "push failing: HTTP 401", "push recovered"]);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("a collector failure is a failed push, not a crash", async () => {
    const p = createPusher({
      collector: { sample: async () => { throw new Error("boom"); } },
      post: async () => 204, ingestUrl: "http://hub.invalid/x", machineId: "m", token: TOKEN, version: "0",
    });
    expect(await p.pushOnce()).toEqual({ ok: false, reason: "Error" });
    await expect(p.prime()).resolves.toBeUndefined();
  });
});
