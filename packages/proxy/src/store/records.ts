/**
 * Append-only UsageRecord store.
 *
 * Ids are ULIDs generated at APPEND time (not request start), so id order equals
 * append order even with concurrent requests. That makes `page(since)` a safe
 * cursor: a record can never appear "behind" a cursor the hub already passed.
 * `ts` keeps the request start time.
 */
import type { UsageRecord, UsageRecordsPage, UsageTotals } from "@bixku/core";

export interface TotalsFilter {
  accountId?: string;
  fromMs: number;
  toMs?: number;
}

export interface RecordStore {
  append(r: UsageRecord): void;
  /** Records with id > since (ascending), at most `limit`. nextCursor = last id when the page is full. */
  page(since: string | null, limit: number): UsageRecordsPage;
  /** Newest first. */
  recent(limit: number): UsageRecord[];
  /** All records with ts >= fromMs (ascending). Used for short windows (last hour). */
  sinceTs(fromMs: number): UsageRecord[];
  totals(f: TotalsFilter): UsageTotals;
  close?(): void;
}

export const emptyTotals = (): UsageTotals => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 });

export function addToTotals(t: UsageTotals, r: UsageRecord): UsageTotals {
  t.requests++;
  t.inputTokens += r.inputTokens;
  t.outputTokens += r.outputTokens;
  t.cacheReadTokens += r.cacheReadTokens;
  t.cacheWriteTokens += r.cacheWriteTokens;
  t.costUsd = Math.round((t.costUsd + (r.costUsd ?? 0)) * 1e6) / 1e6;
  return t;
}

export class MemoryRecordStore implements RecordStore {
  private readonly rows: UsageRecord[] = [];

  append(r: UsageRecord) {
    const last = this.rows[this.rows.length - 1];
    if (last && r.id <= last.id) throw new Error("records must be appended in increasing id order");
    this.rows.push(Object.freeze({ ...r, failedOver: [...r.failedOver] }) as UsageRecord);
  }

  page(since: string | null, limit: number): UsageRecordsPage {
    let lo = 0;
    if (since) {
      // binary search first id > since
      let hi = this.rows.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.rows[mid]!.id <= since) lo = mid + 1;
        else hi = mid;
      }
    }
    const records = this.rows.slice(lo, lo + limit);
    return { records, nextCursor: records.length === limit && records.length > 0 ? records[records.length - 1]!.id : null };
  }

  recent(limit: number) {
    return this.rows.slice(-limit).reverse();
  }

  sinceTs(fromMs: number) {
    return this.rows.filter((r) => Date.parse(r.ts) >= fromMs);
  }

  totals(f: TotalsFilter) {
    const t = emptyTotals();
    for (const r of this.rows) {
      const ts = Date.parse(r.ts);
      if (ts < f.fromMs || (f.toMs !== undefined && ts >= f.toMs)) continue;
      if (f.accountId && r.accountId !== f.accountId) continue;
      addToTotals(t, r);
    }
    return t;
  }
}
