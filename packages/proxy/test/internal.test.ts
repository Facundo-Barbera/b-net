import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountView, ProxyStatus, SecretMeta, UsageRecordsPage } from "@bixku/core";
import { afterAll, describe, expect, it } from "vitest";
import { createProxyApp } from "../src/app.ts";
import { SecretStore } from "../src/secrets.ts";
import { clientRequest, DUMMY_ADMIN, DUMMY_PEPPER, jsonReply, makeDeps } from "./helpers.ts";
import { ANTHROPIC_JSON } from "./fixtures/sse.ts";

const admin = (path: string, token: string | null = DUMMY_ADMIN) => new Request(`http://proxy.test${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

const tmp = mkdtempSync(join(tmpdir(), "bixku-proxy-internal-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("internal API auth", () => {
  it("requires the admin bearer token", async () => {
    const { deps } = makeDeps();
    const app = createProxyApp(deps);
    expect((await app(admin("/internal/v1/status", null))).status).toBe(401);
    expect((await app(admin("/internal/v1/status", "dummy-wrong-token-000000000"))).status).toBe(401);
    expect((await app(admin("/internal/v1/status"))).status).toBe(200);
    expect((await app(admin("/internal/v1/nope"))).status).toBe(404);
  });

  it("a client key does not open the internal API", async () => {
    const { deps } = makeDeps();
    const app = createProxyApp(deps);
    const r = await app(new Request("http://proxy.test/internal/v1/status", { headers: { authorization: clientRequest("/", {}).headers.get("authorization")! } }));
    expect(r.status).toBe(401);
  });
});

describe("internal API payloads", () => {
  async function withTraffic() {
    const ctx = makeDeps();
    const app = createProxyApp(ctx.deps);
    ctx.upstream.fallback = () =>
      jsonReply(ANTHROPIC_JSON, 200, {
        "anthropic-ratelimit-unified-5h-utilization": "0.25",
        "anthropic-ratelimit-unified-5h-reset": String(Math.floor(ctx.clock.now() / 1000) + 3600),
      });
    for (let i = 0; i < 5; i++) {
      await app(clientRequest("/v1/messages", { model: "claude-sonnet-5-5", messages: [] }));
      ctx.clock.advance(1000);
    }
    return { ...ctx, app };
  }

  it("status validates against ProxyStatus and aggregates the last hour", async () => {
    const { app } = await withTraffic();
    const body = await (await app(admin("/internal/v1/status"))).json();
    expect(ProxyStatus.safeParse(body).success).toBe(true);
    expect(body.lastHour.requests).toBe(5);
    expect(body.lastHour.costUsd).toBeCloseTo(5 * 0.0008, 9);
    expect(body.recent).toHaveLength(5);
    expect(body.legacyProxy).toEqual({ name: "CLIProxyAPI", listen: "127.0.0.1:8317", retired: false });
  });

  it("accounts validate against AccountView and carry header windows with totals", async () => {
    const { app } = await withTraffic();
    const { accounts } = await (await app(admin("/internal/v1/accounts"))).json();
    for (const a of accounts) expect(AccountView.safeParse(a).success).toBe(true);
    const a = accounts.find((x: AccountView) => x.id === "anthropic-a") as AccountView;
    expect(a.windows[0]).toMatchObject({ kind: "5h", usedPct: 25, source: "provider-headers" });
    expect(a.windows[0]!.totals.requests).toBe(3); // round-robin a,b,a,b,a
    expect(a.today.requests).toBe(3);
  });

  it("records paginate by ULID cursor without gaps or duplicates", async () => {
    const { app } = await withTraffic();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const q: string = cursor ? `?since=${cursor}&limit=2` : "?limit=2";
      const page = UsageRecordsPage.parse(await (await app(admin(`/internal/v1/records${q}`))).json());
      seen.push(...page.records.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect([...seen].sort()).toEqual(seen);
    expect((await app(admin("/internal/v1/records?since=not-a-ulid"))).status).toBe(400);
  });

  it("clients never expose key hashes", async () => {
    const { app, config } = await withTraffic();
    const text = await (await app(admin("/internal/v1/clients"))).text();
    for (const c of config.clients) expect(text).not.toContain(c.keyHash);
    expect(text).not.toContain("keyHash");
    expect(JSON.parse(text).clients[0].lastUsedAt).not.toBeNull();
  });

  it("secrets endpoint returns SecretMeta only, never values (real SecretStore with dummy values)", async () => {
    const store = new SecretStore(Buffer.alloc(32, 7), join(tmp, "secrets.enc"));
    const DUMMY_VALUES = ["dummy-upstream-value-AAAA", "sk-ant-dummy-not-a-real-key-0000", DUMMY_PEPPER, DUMMY_ADMIN];
    DUMMY_VALUES.forEach((v, i) =>
      store.put(
        { id: `s${i}`, kind: "api-key", label: `dummy ${i}`, provider: "anthropic", accountId: null, storage: "encrypted-file", machineId: "bixku-homelab", createdAt: "2026-11-01T00:00:00.000Z", rotatedAt: null, expiresAt: null },
        v,
      ),
    );
    const { deps } = makeDeps();
    const app = createProxyApp({ ...deps, secrets: store });
    const all = [];
    for (const path of ["/internal/v1/secrets", "/internal/v1/status", "/internal/v1/accounts", "/internal/v1/clients", "/internal/v1/records"]) {
      all.push(await (await app(admin(path))).text());
    }
    const joined = all.join("\n");
    for (const v of DUMMY_VALUES) expect(joined).not.toContain(v);
    const { secrets } = JSON.parse(all[0]!);
    expect(secrets).toHaveLength(4);
    for (const s of secrets) {
      expect(SecretMeta.safeParse(s).success).toBe(true);
      expect(Object.keys(s)).not.toContain("value");
    }
  });
});
