import type { HubSnapshot } from "@b-net/core";
import { StatusDot, toneForMachineStatus } from "../../components/index.ts";
import { formatPercent } from "../../lib/format.ts";
import { STATUS_LABEL, summarize } from "../machines/derive.ts";

/**
 * One-line fleet health for the work home: reachable count, then every machine as glyph + name + status
 * word + CPU when a metrics source reports it. The full picture lives in Máquinas (g m).
 */
export function FleetStrip({ snapshot }: { snapshot: HubSnapshot }) {
  const s = summarize(snapshot.machines, snapshot.hubMachineId);
  return (
    <section className="wk-fleet" aria-labelledby="wk-fleet-title" data-testid="fleet-strip">
      <h2 id="wk-fleet-title" className="wk-fleet__title">
        <a href="#/machines">
          <span className="ui-label">Flota</span>{" "}
          <span className="num">{s.online}/{s.total}</span> <span className="u-muted">alcanzables</span>
        </a>
      </h2>
      {snapshot.machines.length === 0 ? (
        <p className="u-muted">Sin máquinas en machines.json.</p>
      ) : (
        <ul className="wk-fleet__list">
          {snapshot.machines.map((m) => {
            const cpu = m.metrics?.cpuPct;
            return (
              <li key={m.id} className="wk-fleet__item" data-testid={`fleet-${m.id}`} data-status={m.status}>
                <StatusDot tone={toneForMachineStatus(m.status)} />
                <span className="wk-fleet__name">{m.name}</span>
                <span className="wk-fleet__status">{STATUS_LABEL[m.status]}</span>
                {cpu != null && <span className="wk-fleet__cpu num" title="CPU">CPU {formatPercent(cpu)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
