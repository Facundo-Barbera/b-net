import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UsageRecord } from "@fhub/core";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryRecordStore, type RecordStore } from "../src/store/records.ts";
import { SqliteRecordStore } from "../src/store/sqlite.ts";
import { createUlidFactory, iso } from "../src/util.ts";
import { FakeClock, T0 } from "./helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "fhub-proxy-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function rec(id: string, tsMs: number, over: Partial<UsageRecord> = {}): UsageRecord {
  return {
    id,
    ts: iso(tsMs),
    durationMs: 100,
    ttftMs: 50,
    clientId: "c",
    format: "anthropic-messages",
    provider: "anthropic",
    accountId: "a",
    model: "claude-opus-5-5",
    requestedModel: "claude-opus-5-5",
    stream: false,
    status: 200,
    outcome: "ok",
    failedOver: [],
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 1,
    cacheWriteTokens: 2,
    reasoningTokens: 0,
    costUsd: 0.001,
    ...over,
  };
}

const impls: Array<[string, () => RecordStore]> = [
  ["memory", () => new MemoryRecordStore()],
  ["sqlite :memory:", () => new SqliteRecordStore(":memory:")],
  ["sqlite file", () => new SqliteRecordStore(join(dir, `r-${Math.random().toString(36).slice(2)}.sqlite`))],
];

describe.each(impls)("RecordStore (%s)", (_name, make) => {
  function filled() {
    const s = make();
    const clock = new FakeClock();
    const ids = createUlidFactory(clock);
    const out: UsageRecord[] = [];
    for (let i = 0; i < 7; i++) {
      const r = rec(ids(), T0 - i * 3600_000, { accountId: i % 2 ? "b" : "a", costUsd: i === 3 ? null : 0.001 });
      s.append(r);
      out.push(r);
      clock.advance(i % 3 === 0 ? 0 : 1); // same-ms ids exercise monotonicity
    }
    return { s, out };
  }

  it("pages by cursor", () => {
    const { s, out } = filled();
    const p1 = s.page(null, 3);
    expect(p1.records.map((r) => r.id)).toEqual(out.slice(0, 3).map((r) => r.id));
    expect(p1.nextCursor).toBe(out[2]!.id);
    const p3 = s.page(out[5]!.id, 3);
    expect(p3.records.map((r) => r.id)).toEqual([out[6]!.id]);
    expect(p3.nextCursor).toBeNull();
    expect(s.page(out[6]!.id, 3)).toEqual({ records: [], nextCursor: null });
  });

  it("recent is newest first; sinceTs filters by request time", () => {
    const { s, out } = filled();
    expect(s.recent(2).map((r) => r.id)).toEqual([out[6]!.id, out[5]!.id]);
    expect(s.sinceTs(T0 - 2 * 3600_000).length).toBe(3);
  });

  it("totals by account and time range (null cost counts as 0)", () => {
    const { s } = filled();
    const all = s.totals({ fromMs: 0 });
    expect(all).toEqual({ requests: 7, inputTokens: 70, outputTokens: 35, cacheReadTokens: 7, cacheWriteTokens: 14, costUsd: 0.006 });
    expect(s.totals({ fromMs: 0, accountId: "b" }).requests).toBe(3);
    expect(s.totals({ fromMs: T0 - 3600_000, toMs: T0 }).requests).toBe(1);
  });

  it("round-trips the full record", () => {
    const s = make();
    const r = rec("01JZZZZZZZZZZZZZZZZZZZZZZZ", T0, { failedOver: ["x", "y"], costUsd: null });
    s.append(r);
    expect(s.recent(1)[0]).toEqual(r);
  });
});

describe("SqliteRecordStore append-only", () => {
  it("rejects UPDATE and DELETE via triggers", async () => {
    const path = join(dir, "ao.sqlite");
    const s = new SqliteRecordStore(path);
    s.append(rec("01JAAAAAAAAAAAAAAAAAAAAAAA", T0));
    s.close();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path);
    expect(() => db.exec("UPDATE usage_records SET account_id = 'z'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM usage_records")).toThrow(/append-only/);
    db.close();
  });
});

describe("ULID factory", () => {
  it("is monotonic within the same millisecond and sortable across time", () => {
    const clock = new FakeClock();
    const ids = createUlidFactory(clock, () => new Uint8Array(16).fill(31));
    const a = ids();
    const b = ids();
    clock.advance(1);
    const c = ids();
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b && b < c).toBe(true);
    clock.t -= 10; // clock going backwards must not break ordering
    expect(ids() > c).toBe(true);
  });
});
