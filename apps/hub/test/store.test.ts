import { describe, expect, it } from "vitest";
import { snapshotFixture, type UsageRecord } from "@fhub/core";
import { MemoryUsageStore, type UsageStore } from "../src/store.ts";
import { SqliteUsageStore } from "../src/store-sqlite.ts";
import { ingestUsage } from "../src/sources.ts";
import { fakeFetch, PROXY_TOKEN } from "./helpers.ts";

const base = snapshotFixture.proxy!.recent[0]!;
const rec = (i: number, accountId = "anthropic-max-1"): UsageRecord => ({ ...base, id: `01JD${String(i).padStart(22, "0")}`, accountId });
const many = Array.from({ length: 23 }, (_, i) => rec(i + 1, i % 4 === 0 ? "openai-pro-1" : "anthropic-max-1"));

for (const [name, make] of [
  ["memory", () => new MemoryUsageStore()],
  ["sqlite", () => new SqliteUsageStore(":memory:")],
] as [string, () => UsageStore][]) {
  describe(`UsageStore (${name})`, () => {
    it("appends idempotently and lists by cursor/account", () => {
      const s = make();
      expect(s.append(many.slice(0, 10))).toBe(10);
      expect(s.append(many)).toBe(13);
      expect(s.count()).toBe(23);
      const p = s.list({ limit: 10 });
      expect(p.records.map((r) => r.id)).toEqual(many.slice(0, 10).map((r) => r.id));
      expect(p.nextCursor).toBe(many[9]!.id);
      const last = s.list({ since: many[19]!.id, limit: 10 });
      expect(last.records).toHaveLength(3);
      expect(last.nextCursor).toBeNull();
      expect(s.list({ accountId: "openai-pro-1", limit: 100 }).records).toHaveLength(6);
      expect(s.list({ limit: 100 }).records[0]).toEqual(many[0]);
      s.close?.();
    });

    it("persists the cursor", () => {
      const s = make();
      expect(s.getCursor()).toBeNull();
      s.setCursor("01ABC");
      s.setCursor("01ABD");
      expect(s.getCursor()).toBe("01ABD");
      s.close?.();
    });

    it("ingests from the proxy in pages and resumes from the cursor", async () => {
      const s = make();
      const { fetch } = fakeFetch({ records: many.slice(0, 15) });
      const r1 = await ingestUsage(fetch, "http://proxy.invalid", PROXY_TOKEN, s, { pageSize: 4 });
      expect(r1).toEqual({ added: 15, pages: 4, cursor: many[14]!.id });
      const { fetch: f2, calls } = fakeFetch({ records: many });
      const r2 = await ingestUsage(f2, "http://proxy.invalid", PROXY_TOKEN, s, { pageSize: 100 });
      expect(r2.added).toBe(8);
      expect(calls).toHaveLength(1);
      expect(s.count()).toBe(23);
      s.close?.();
    });
  });
}

it("ingestion fails on bad token without touching the cursor", async () => {
  const s = new MemoryUsageStore();
  const { fetch } = fakeFetch({ records: many });
  await expect(ingestUsage(fetch, "http://proxy.invalid", "wrong", s)).rejects.toThrow(/HTTP 401/);
  expect(s.getCursor()).toBeNull();
});
