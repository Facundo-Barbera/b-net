import { useState } from "react";
import type { ViewProps } from "../../routes.tsx";
import "./machines.css";
import { summarize } from "./derive.ts";
import { relTime, toMs, type NowInput } from "./format.ts";
import { MachineCard } from "./MachineCard.tsx";
import { MachineDetail } from "./MachineDetail.tsx";
import { SummaryStrip } from "./SummaryStrip.tsx";
import { Topology } from "./Topology.tsx";

export interface MachinesViewProps extends ViewProps {
  /** Reference time for every relative label. Defaults to Date.now(); tests inject FIXTURE_NOW. */
  now?: NowInput;
  /** Preselect a machine (otherwise the detail panel starts empty). */
  initialSelectedId?: string | null;
}

export function MachinesView({ snapshot, now, initialSelectedId = null }: MachinesViewProps) {
  const nowMs = toMs(now);
  const [selected, setSelected] = useState<string | null>(initialSelectedId);
  const machines = snapshot.machines;
  const selectedMachine = machines.find((m) => m.id === selected) ?? null;
  const summary = summarize(machines, snapshot.hubMachineId);

  return (
    <section className="mv" data-testid="view-machines" aria-labelledby="mv-title">
      <header className="mv-head">
        <h1 id="mv-title">Machines</h1>
        <span className="mv-head__sub num">
          {machines.length} machines · snapshot {relTime(snapshot.generatedAt, nowMs)} · hub {snapshot.hubVersion}
        </span>
      </header>

      <SummaryStrip summary={summary} />

      <Topology machines={machines} hubId={snapshot.hubMachineId} selectedId={selected} onSelect={setSelected} />

      <div className="mv-main">
        <div className="mv-cards" role="list" aria-label="Machines">
          {machines.map((m) => (
            <div role="listitem" key={m.id}>
              <MachineCard m={m} isHub={m.id === snapshot.hubMachineId} selected={selected === m.id} nowMs={nowMs} onSelect={() => setSelected(m.id)} />
            </div>
          ))}
        </div>
        <aside className="mv-aside" data-empty={selectedMachine ? undefined : true}>
          {selectedMachine ? (
            <MachineDetail
              machine={selectedMachine}
              threads={snapshot.threads.filter((t) => t.machineId === selectedMachine.id)}
              sources={snapshot.sources}
              nowMs={nowMs}
              onClose={() => setSelected(null)}
            />
          ) : (
            <p className="mv-empty mv-panel" data-testid="detail-empty">Select a machine on the map or in the list to see its history and T3 threads.</p>
          )}
        </aside>
      </div>
    </section>
  );
}
