import { Callout } from "../components/Callout.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { NowProvider, useClock } from "../components/now.tsx";
import { getDataMode, useSnapshot, type DataMode } from "../data/useSnapshot.ts";
import { Shell } from "./Shell.tsx";
import { useHashRoute } from "./useHashRoute.ts";

/**
 * Root: data (useSnapshot) + hash routing + shell. `mode` overrides `?data=` (tests).
 * In fixture mode relative times are computed against `generatedAt` so the fixture looks live.
 */
export function App({ mode }: { mode?: DataMode } = {}) {
  const dataMode = mode ?? getDataMode();
  const { snapshot, error } = useSnapshot(dataMode);
  const route = useHashRoute();
  const clock = useClock();
  const now = dataMode === "fixture" && snapshot ? Date.parse(snapshot.generatedAt) : clock;
  const View = route.component;

  return (
    <NowProvider value={now}>
      <Shell route={route} snapshot={snapshot} mode={dataMode}>
        {snapshot ? (
          <>
            {error && (
              <Callout tone="warn" role="alert" className="sh-banner">
                Showing the last snapshot — refresh failed: {error}
              </Callout>
            )}
            <View snapshot={snapshot} />
          </>
        ) : error ? (
          <EmptyState role="alert" title="Can't reach the hub" description={error} />
        ) : (
          <EmptyState role="status" title="Loading snapshot…" />
        )}
      </Shell>
    </NowProvider>
  );
}
