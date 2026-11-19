import type { HubSnapshot } from "@b-net/core";
import { Meter, StatusDot, meterTone, toneForMachineStatus } from "../../components/index.ts";
import { formatPercent } from "../../lib/format.ts";
import { STATUS_LABEL, summarize } from "../machines/derive.ts";

/**
 * Fleet at a glance on the work rail: reachable count (the one link, to Máquinas, g m), then every machine as
 * glyph + name + status word, with a CPU bar when a metrics source reports it. Machines that are down sort
 * first so a problem is the first thing read.
 */
export function FleetStrip({ snapshot }: { snapshot: HubSnapshot }) {
  const s = summarize(snapshot.machines, snapshot.hubMachineId);
  const rank = { offline: 0, degraded: 1, unknown: 2, paused: 3, online: 4 } as const;
  const machines = [...snapshot.machines].sort((a, b) => rank[a.status] - rank[b.status]);
  return (
    <section className="wk-fleet" aria-labelledby="wk-fleet-title" data-testid="fleet-strip">
      <h2 id="wk-fleet-title" className="wk-fleet__title">
        <a href="#/machines">
          <span>Flota</span>{" "}
          <span className="num">{s.online}/{s.total}</span> <span className="u-muted">alcanzables</span>
        </a>
      </h2>
      {snapshot.machines.length === 0 ? (
        <p className="u-muted">Sin máquinas en machines.json.</p>
      ) : (
        <ul className="wk-fleet__list">
          {machines.map((m) => {
            const cpu = m.metrics?.cpuPct;
            // The bar has no room for Meter's HIGH/CRIT flag, so the level is said in words next to the number.
            const level = cpu == null ? undefined : { warn: " · alta", danger: " · crítica" }[meterTone(cpu) as "warn" | "danger"];
            return (
              <li key={m.id} className="wk-fleet__item" data-testid={`fleet-${m.id}`} data-status={m.status}>
                <StatusDot tone={toneForMachineStatus(m.status)} />
                <span className="wk-fleet__name">{m.name}</span>
                <span className="wk-fleet__status">{STATUS_LABEL[m.status]}</span>
                {cpu != null && (
                  <span className="wk-fleet__cpu">
                    <span className="num" title="CPU">CPU {formatPercent(cpu)}{level}</span>
                    <Meter value={cpu} ariaLabel={`CPU de ${m.name}`} flag={false} className="wk-fleet__bar" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
