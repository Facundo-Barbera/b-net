import { HubRoutes } from "@b-net/core";
import { Callout } from "../components/Callout.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { NowProvider, useClock } from "../components/now.tsx";
import { getDataMode, useSnapshot, useWork, type DataMode } from "../data/useSnapshot.ts";
import { routes } from "../routes.tsx";
import { Shell } from "./Shell.tsx";
import { useGoShortcuts } from "./useGoShortcuts.ts";
import { useHashRoute } from "./useHashRoute.ts";

/**
 * Root: data (useSnapshot + useWork) + hash routing + "g <key>" shortcuts + shell. `mode` overrides `?data=` (tests).
 * In fixture mode relative times are computed against `generatedAt` so the fixture looks live.
 */
export function App({ mode }: { mode?: DataMode } = {}) {
  const dataMode = mode ?? getDataMode();
  const { snapshot, error } = useSnapshot(dataMode);
  const work = useWork(dataMode);
  const route = useHashRoute();
  useGoShortcuts(routes);
  const clock = useClock();
  const now = dataMode === "fixture" && snapshot ? Date.parse(snapshot.generatedAt) : clock;
  const View = route.component;

  return (
    <NowProvider value={now}>
      <Shell route={route} snapshot={snapshot} work={work.data} mode={dataMode}>
        {snapshot ? (
          <>
            {error && (
              <Callout tone="warn" role="alert" className="sh-banner">
                Mostrando el último snapshot: falló la actualización ({error})
              </Callout>
            )}
            <View snapshot={snapshot} work={work} />
          </>
        ) : error ? (
          <EmptyState role="alert" title="No se puede contactar al hub" description={`${HubRoutes.snapshot}: ${error}`}>
            <p className="ui-empty__how">
              <span className="ui-label">Revisa</span> que el hub esté corriendo. En dev, vite reenvía /api a WEB_HUB_URL
              (por defecto http://127.0.0.1:8780). Para ver la UI sin hub, abre <code>?data=fixture</code>.
            </p>
          </EmptyState>
        ) : (
          <EmptyState role="status" title="Cargando snapshot…" />
        )}
      </Shell>
    </NowProvider>
  );
}
