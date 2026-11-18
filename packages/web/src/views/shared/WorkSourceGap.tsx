import type { WorkSourceState } from "@b-net/core";
import { EmptyState, StatusDot } from "../../components/index.ts";
import { WORK_SOURCE_SETUP, type WorkSourceKind } from "../../data/sources.ts";

/**
 * Inline empty state for a section whose work source is not connected or not answering: names the source,
 * what it would show and how to connect it. Never rendered for a connected source (that is a real "nothing").
 */
export function WorkSourceGap({ kind, state, testId }: { kind: WorkSourceKind; state: WorkSourceState; testId?: string }) {
  const s = WORK_SOURCE_SETUP[kind];
  const failing = state === "failing";
  return (
    <EmptyState
      compact
      className="wk-gap"
      data-testid={testId ?? `gap-${kind}`}
      data-source-state={state}
      icon={<StatusDot tone={failing ? "danger" : "dormant"} label={failing ? "no responde" : "sin conectar"} />}
      title={failing ? `${s.name} no responde: no llegan ${s.feeds}.` : `${s.name} sin conectar: aquí verías ${s.feeds}.`}
    >
      <p className="ui-empty__how">
        <span className="ui-label">Qué falta</span> {s.connect}
      </p>
    </EmptyState>
  );
}
