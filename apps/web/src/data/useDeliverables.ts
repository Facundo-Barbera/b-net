import { useEffect, useState } from "react";
import { HubRoutes, projectsFixture, type Deliverable } from "@fhub/core";
import type { DataMode } from "./useSnapshot.ts";

export const deliverablesUrl = (projectId: string) => HubRoutes.deliverables.replace(":id", encodeURIComponent(projectId));
export const deliverableContentUrl = (d: Pick<Deliverable, "projectId" | "id">, download = false) =>
  HubRoutes.deliverableContent.replace(":id", encodeURIComponent(d.projectId)).replace(":deliverableId", d.id) + (download ? "?download=1" : "");

export interface DeliverablesState {
  data: Deliverable[] | null;
  error: string | null;
}

/**
 * Deliverables of one registered project (newest first). Refetches when `version` changes (the work
 * snapshot's count/last activity), so a new upload shows up without polling a second endpoint.
 */
export function useDeliverables(projectId: string | null, mode: DataMode, version: string): DeliverablesState {
  const [state, setState] = useState<DeliverablesState>({ data: null, error: null });
  useEffect(() => {
    if (!projectId) return setState({ data: null, error: null });
    if (mode === "fixture") {
      return setState({ data: projectsFixture.find((p) => p.project.id === projectId)?.deliverables ?? [], error: null });
    }
    let alive = true;
    fetch(deliverablesUrl(projectId), { headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { deliverables: Deliverable[] };
        if (alive) setState({ data: body.deliverables, error: null });
      })
      .catch((e: unknown) => alive && setState((s) => ({ data: s.data, error: e instanceof Error ? e.message : String(e) })));
    return () => {
      alive = false;
    };
  }, [projectId, mode, version]);
  return state;
}
