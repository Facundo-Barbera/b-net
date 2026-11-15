import { useEffect, useState } from "react";
import { HubRoutes, snapshotFixture, type HubSnapshot } from "@b-net/core";

/**
 * Data access for every view. Mode "fixture" (default in phase 1 / tests) returns the
 * canonical fixture; mode "live" polls the hub API. Views must only use this hook.
 */
export type DataMode = "fixture" | "live";

export function getDataMode(): DataMode {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("data") : null;
  return q === "live" ? "live" : "fixture";
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
