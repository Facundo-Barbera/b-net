/**
 * Usage-record store (hub side). Records come from the proxy (/internal/v1/records) and are
 * stored append-only, idempotent by ULID id. The ingestion cursor is persisted with them.
 */
import type { UsageRecord, UsageRecordsPage } from "@b-net/core";

export interface ListQuery {
  /** Exclusive lower bound (ULID). */
  since?: string | null;
  accountId?: string | null;
  limit: number;
}

export interface UsageStore {
  /** Insert records; existing ids are ignored. Returns how many were new. */
  append(records: UsageRecord[]): number;
  list(q: ListQuery): UsageRecordsPage;
  getCursor(): string | null;
  setCursor(cursor: string): void;
  count(): number;
  close?(): void;
}

export const MAX_PAGE = 1000;

export class MemoryUsageStore implements UsageStore {
  private readonly byId = new Map<string, UsageRecord>();
  private sorted: UsageRecord[] = [];
  private cursor: string | null = null;

  append(records: UsageRecord[]): number {
    let added = 0;
    for (const r of records) {
      if (this.byId.has(r.id)) continue;
      this.byId.set(r.id, r);
      added++;
    }
    if (added) this.sorted = [...this.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return added;
  }

  list(q: ListQuery): UsageRecordsPage {
    const limit = Math.max(1, Math.min(q.limit, MAX_PAGE));
    const matches = this.sorted.filter((r) => (!q.since || r.id > q.since) && (!q.accountId || r.accountId === q.accountId));
    const records = matches.slice(0, limit);
    return { records, nextCursor: matches.length > limit ? records.at(-1)!.id : null };
  }

  getCursor() {
    return this.cursor;
  }
  setCursor(c: string) {
    this.cursor = c;
  }
  count() {
    return this.byId.size;
  }
}
