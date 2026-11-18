import { useEffect, useState } from "react";
import { HubRoutes, snapshotFixture, type HubSnapshot } from "@b-net/core";

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

export function useSnapshot(mode: DataMode = getDataMode(), intervalMs = 15_000) {
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(mode === "fixture" ? snapshotFixture : null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (mode === "fixture") return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(HubRoutes.snapshot, { headers: { accept: "application/json" } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as HubSnapshot;
        if (alive) { setSnapshot(body); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const t = setInterval(load, intervalMs);
    return () => { alive = false; clearInterval(t); };
  }, [mode, intervalMs]);
  return { snapshot, error };
}
