import { useEffect, useState } from "react";
import { HubRoutes, WorkSnapshot, snapshotFixture, workFixture, type HubSnapshot } from "@b-net/core";

/**
 * Data access for every view. Mode "live" (default) polls the hub API; mode "fixture" returns the
 * canonical fixture, for demos and screenshots without a hub. Views must only use this hook.
 */
export type DataMode = "fixture" | "live";

/**
 * Live unless asked for the fixture: `?data=fixture` in the URL, or `VITE_DATA_MODE=fixture` at
 * build/dev time. `?data=live` overrides the variable, so one build can still show real data.
 */
export function getDataMode(
  search: string = typeof location !== "undefined" ? location.search : "",
  envMode: string | undefined = import.meta.env.VITE_DATA_MODE,
): DataMode {
  const q = new URLSearchParams(search).get("data");
  if (q === "fixture" || q === "live") return q;
  return envMode === "fixture" ? "fixture" : "live";
}

/**
 * Polls a JSON endpoint every `intervalMs`; in fixture mode returns `fixture` and never fetches. Keeps the last
 * good value on error. `parse` validates the body (throwing = treated like a failed request).
 */
export function usePolled<T>(url: string, fixture: T, mode: DataMode, intervalMs = 15_000, parse?: (body: unknown) => T) {
  const [data, setData] = useState<T | null>(mode === "fixture" ? fixture : null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode === "fixture") return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw: unknown = await res.json();
        const body = parse ? parse(raw) : (raw as T);
        if (alive) { setData(body); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
    // parse is a module-level function in every caller; leaving it out keeps the effect from restarting.
  }, [url, mode, intervalMs]);
  return { data, error };
}

export function useSnapshot(mode: DataMode = getDataMode(), intervalMs = 15_000) {
  const { data, error } = usePolled<HubSnapshot>(HubRoutes.snapshot, snapshotFixture, mode, intervalMs);
  return { snapshot: data, error };
}

/** A hub older than this UI answers /api/v1/work with 404; one with another shape fails here instead of in a view. */
function parseWork(body: unknown): WorkSnapshot {
  const r = WorkSnapshot.safeParse(body);
  if (!r.success) throw new Error("respuesta con forma inesperada");
  return r.data;
}

/** Work home state handed to every view (views that do not need it ignore it). */
export interface WorkState {
  data: WorkSnapshot | null;
  error: string | null;
  mode: DataMode;
}

export function useWork(mode: DataMode = getDataMode(), intervalMs = 15_000): WorkState {
  const { data, error } = usePolled<WorkSnapshot>(HubRoutes.work, workFixture, mode, intervalMs, parseWork);
  return { data, error, mode };
}
