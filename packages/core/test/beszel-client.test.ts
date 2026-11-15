import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MachineMetrics } from "../src/index.ts";
import { createBeszelClient, mapBeszelMetrics, pocketbaseTimeToIso, BeszelSystemRecord, type FetchLike } from "../src/clients/beszel/index.ts";

const fx = (p: string) => JSON.parse(readFileSync(new URL(`./fixtures/beszel/${p}`, import.meta.url), "utf8"));
const systems = fx("systems.json");
const statsBySystem: Record<string, unknown> = fx("stats-by-system.json");
const PASSWORD = "placeholder-password";

function fakeBeszel(opts: { expireFirstToken?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let authCount = 0;
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const u = new URL(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.pathname === "/api/collections/users/auth-with-password") {
      authCount++;
      const body = JSON.parse(String(init?.body));
      if (body.password !== PASSWORD) return json({ message: "Failed to authenticate." }, 400);
      return json({ ...fx("auth.json"), token: `FAKE-TOKEN-${authCount}` });
    }
    const auth = new Headers(init?.headers).get("authorization");
    if (!auth) return json({}, 401);
    if (opts.expireFirstToken && auth === "FAKE-TOKEN-1") return json({}, 401);
    if (u.pathname === "/api/collections/systems/records") return json(systems);
    if (u.pathname === "/api/collections/system_stats/records") {
      const id = /system='([^']+)'/.exec(u.searchParams.get("filter") ?? "")?.[1] ?? "";
      return json(statsBySystem[id] ?? { page: 1, perPage: 30, totalItems: 0, totalPages: 0, items: [] });
    }
    return json({}, 404);
  };
  return { f, calls, authCount: () => authCount };
}

describe("beszel client", () => {
  it("authenticates, lists systems and maps metrics", async () => {
    const { f, calls } = fakeBeszel();
    const client = createBeszelClient({ baseUrl: "http://beszel.invalid:8090/", email: "hub@example.invalid", password: PASSWORD, fetch: f });
    const machines = await client.fetchMachines();
    expect(machines.map((m) => m.name)).toEqual(["bixku-homelab", "bixku-vps", "focaltec", "old-server"]);
    const home = machines[0]!;
    expect(MachineMetrics.safeParse(home.metrics).success).toBe(true);
    expect(home.metrics).toMatchObject({ cpuPct: 23.4, memPct: 71.2, memUsedGb: 5.34, memTotalGb: 7.5, diskPct: 48.1, diskTotalGb: 233, load1: 0.92, uptimeSec: 1904400, tempC: 52 });
    expect(home.metrics!.netRxBps).toBe(Math.round(0.1736 * 1024 * 1024));
    expect(home.metricsAt).toBe("2026-11-15T20:29:00.000Z");
    expect(home.history?.cpuPct).toHaveLength(5);
    expect(machines[3]!.metrics).toBeNull();
    // one auth only; token sent raw in authorization header (PocketBase style)
    expect(calls.filter((c) => c.url.includes("auth-with-password"))).toHaveLength(1);
  });

  it("re-authenticates once on 401", async () => {
    const { f, authCount } = fakeBeszel({ expireFirstToken: true });
    const client = createBeszelClient({ baseUrl: "http://beszel.invalid", email: "x@example.invalid", password: PASSWORD, fetch: f });
    expect(await client.listSystems()).toHaveLength(4);
    expect(authCount()).toBe(2);
  });

  it("never leaks the password or token in errors", async () => {
    const { f } = fakeBeszel();
    const client = createBeszelClient({ baseUrl: "http://beszel.invalid", email: "x@example.invalid", password: "wrong-secret-value", fetch: f });
    const err = await client.listSystems().catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toMatch(/wrong-secret-value|FAKE-TOKEN/);
  });

  it("tolerates unknown fields and missing stats", () => {
    const sys = BeszelSystemRecord.parse({ id: "a", name: "n", status: "up", info: { cpu: 150, mp: 10, zz: "new" }, extra: 1 });
    const m = mapBeszelMetrics(sys, undefined)!;
    expect(m.cpuPct).toBe(100);
    expect(m.netRxBps).toBeNull();
    expect(MachineMetrics.safeParse(m).success).toBe(true);
  });

  it("parses PocketBase timestamps", () => {
    expect(pocketbaseTimeToIso("2026-11-15 20:29:00.123Z")).toBe("2026-11-15T20:29:00.123Z");
    expect(pocketbaseTimeToIso("")).toBeNull();
  });
});
