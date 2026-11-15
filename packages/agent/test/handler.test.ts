import { describe, expect, it, vi } from "vitest";
import { AgentHealth, AgentMetrics, AgentRoutes, AgentThreads, type T3ThreadView } from "@b-net/core";
import type { T3ReadResult } from "@b-net/core/clients/t3";
import { createAgentHandler, safeEqual, type AgentHandlerDeps } from "../src/handler.ts";
import { ConfigError, isWildcardHost, loadConfig } from "../src/config.ts";

const TOKEN = "test-token-0123456789-placeholder";
const base = "http://100.64.0.1:8781";

const thread: T3ThreadView = {
  id: "t1",
  machineId: "someone-else", // handler must overwrite with its own machineId
  projectTitle: "demo",
  title: "A thread",
  provider: "claudeAgent",
  model: "fake-model",
  state: "idle",
  branch: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastRunStatus: "completed",
  runningSince: null,
  parentThreadId: null,
};

function setup(over: Partial<AgentHandlerDeps> = {}) {
  const readThreads = vi.fn(
    (): T3ReadResult => ({ threads: [thread], health: { ok: true, reason: null, detail: null, degraded: [] } }),
  );
  const getMetrics = vi.fn(async () => ({
    at: new Date("2026-01-01T00:01:00Z"),
    metrics: {
      cpuPct: 12, memPct: 50, memUsedGb: 4, memTotalGb: 8, diskPct: 40, diskUsedGb: 40, diskTotalGb: 100,
      load1: 0.5, netRxBps: null, netTxBps: null, uptimeSec: 100, tempC: null,
    },
    history: { stepSec: 60, cpuPct: [12], memPct: [50] },
  }));
  const handler = createAgentHandler({
    machineId: "b-net-test",
    token: TOKEN,
    version: "0.1.0",
    startedAt: new Date("2026-01-01T00:00:00Z"),
    getMetrics,
    readThreads,
    ...over,
  });
  return { handler, readThreads, getMetrics };
}

const get = (path: string, headers: Record<string, string> = {}, method = "GET") =>
  new Request(base + path, { method, headers });
const auth = { authorization: `Bearer ${TOKEN}` };

describe("agent handler: auth", () => {
  it.each(Object.values(AgentRoutes))("%s requires a bearer token", async (route) => {
    const { handler, readThreads, getMetrics } = setup();
    const bad: Array<Record<string, string>> = [{}, { authorization: "Bearer wrong" }, { authorization: TOKEN }, { authorization: "Basic abc" }, { authorization: "Bearer " }];
    for (const headers of bad) {
      const res = await handler(get(route, headers));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toMatch(/^Bearer/);
      expect(await res.text()).not.toContain(TOKEN);
    }
    // no data work is done for unauthenticated callers
    expect(readThreads).not.toHaveBeenCalled();
    expect(getMetrics).not.toHaveBeenCalled();
  });

  it("rejects near-miss tokens (prefix, suffix, different case)", async () => {
    const { handler } = setup();
    for (const t of [TOKEN.slice(0, -1), TOKEN + "x", TOKEN.toUpperCase()]) {
      expect((await handler(get(AgentRoutes.health, { authorization: `Bearer ${t}` }))).status).toBe(401);
    }
  });

  it("accepts the right token (scheme is case-insensitive)", async () => {
    const { handler } = setup();
    expect((await handler(get(AgentRoutes.health, { authorization: `bearer ${TOKEN}` }))).status).toBe(200);
  });

  it("refuses to be built with an empty token (fail closed)", () => {
    expect(() => setup({ token: "" })).toThrow();
  });

  it("safeEqual compares correctly, regardless of length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("agent handler: routes", () => {
  it("health matches AgentHealth and reports t3Available", async () => {
    const { handler } = setup();
    const res = await handler(get(AgentRoutes.health, auth));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = AgentHealth.parse(await res.json());
    expect(body).toMatchObject({ machineId: "b-net-test", version: "0.1.0", t3Available: true });

    const down = setup({
      readThreads: () => ({ threads: [], health: { ok: false, reason: "db_not_found", detail: "x", degraded: [] } }),
    });
    expect(AgentHealth.parse(await (await down.handler(get(AgentRoutes.health, auth))).json()).t3Available).toBe(false);
  });

  it("metrics matches AgentMetrics", async () => {
    const { handler } = setup();
    const body = AgentMetrics.parse(await (await handler(get(AgentRoutes.metrics, auth))).json());
    expect(body.machineId).toBe("b-net-test");
    expect(body.at).toBe("2026-01-01T00:01:00.000Z");
    expect(body.history?.cpuPct).toEqual([12]);
  });

  it("t3/threads fills machineId from config and matches AgentThreads", async () => {
    const { handler } = setup();
    const body = AgentThreads.parse(await (await handler(get(AgentRoutes.t3Threads, auth))).json());
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]!.machineId).toBe("b-net-test");
  });

  it("t3 unavailable still answers 200 with an empty list", async () => {
    const { handler } = setup({
      readThreads: () => ({ threads: [], health: { ok: false, reason: "db_not_found", detail: null, degraded: [] } }),
    });
    const res = await handler(get(AgentRoutes.t3Threads, auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ threads: [] });
  });

  it("404 for unknown paths, 405 for writes, HEAD has no body, query strings are ignored", async () => {
    const { handler } = setup();
    expect((await handler(get("/agent/v1/nope", auth))).status).toBe(404);
    expect((await handler(get(AgentRoutes.metrics, auth, "POST"))).status).toBe(405);
    const head = await handler(get(AgentRoutes.metrics, auth, "HEAD"));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await handler(get(`${AgentRoutes.metrics}?x=1`, auth))).status).toBe(200);
  });

  it("internal failures return a generic 500 without details", async () => {
    const { handler } = setup({
      getMetrics: async () => {
        throw new Error("secret internal path /home/x");
      },
    });
    const res = await handler(get(AgentRoutes.metrics, auth));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("/home/x");
  });
});

describe("agent config", () => {
  const env = {
    AGENT_MACHINE_ID: "bixku-vps",
    AGENT_LISTEN_HOST: "100.64.0.9",
    AGENT_TOKEN_FILE: "/run/credentials/agent-token",
  };
  const read = () => `${TOKEN}\n`;

  it("loads with defaults and trims the token file", () => {
    expect(loadConfig(env, read)).toMatchObject({
      machineId: "bixku-vps",
      listenHost: "100.64.0.9",
      port: 8781,
      token: TOKEN,
      sampleIntervalSec: 60,
      historyPoints: 30,
      t3DbPath: undefined,
    });
  });

  it("refuses wildcard and missing hosts", () => {
    for (const h of ["0.0.0.0", "::", "[::]", "", "*"]) {
      expect(isWildcardHost(h)).toBe(true);
      expect(() => loadConfig({ ...env, AGENT_LISTEN_HOST: h }, read)).toThrow(ConfigError);
    }
    expect(() => loadConfig({ ...env, AGENT_LISTEN_HOST: "some.hostname" }, read)).toThrow(ConfigError);
  });

  it("refuses short tokens, unreadable token files and bad ids/ports", () => {
    expect(() => loadConfig(env, () => "short")).toThrow(/token/);
    expect(() => loadConfig(env, () => { throw new Error("ENOENT"); })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, AGENT_MACHINE_ID: "Bad Id" }, read)).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, AGENT_PORT: "99999" }, read)).toThrow(ConfigError);
  });

  it("error messages never contain the token", () => {
    try {
      loadConfig({ ...env, AGENT_LISTEN_HOST: "0.0.0.0" }, read);
    } catch (e) {
      expect(String(e)).not.toContain(TOKEN);
    }
  });
});
