import { useState } from "react";
import { Card, EmptyState, PageHeader, useNow } from "../../components/index.ts";
import { formatRelative } from "../../lib/format.ts";
import type { ViewProps } from "../../routes.tsx";
import "./machines.css";
import { summarize } from "./derive.ts";
import { MachineCard } from "./MachineCard.tsx";
import { MachineDetail } from "./MachineDetail.tsx";
import { SummaryStrip } from "./SummaryStrip.tsx";
import { Topology } from "./Topology.tsx";

export interface MachinesViewProps extends ViewProps {
  /** Preselect a machine (otherwise the detail panel starts empty). */
  initialSelectedId?: string | null;
}

export function MachinesView({ snapshot, initialSelectedId = null }: MachinesViewProps) {
  const nowMs = useNow();
  const [selected, setSelected] = useState<string | null>(initialSelectedId);
  const machines = snapshot.machines;
  const selectedMachine = machines.find((m) => m.id === selected) ?? null;
  const summary = summarize(machines, snapshot.hubMachineId);

  return (
    <section className="ui-view mv" data-testid="view-machines" aria-labelledby="mv-title">
      <PageHeader
        title="Machines"
        titleId="mv-title"
        subtitle={
          <span className="num">
            {machines.length} machines · snapshot {formatRelative(snapshot.generatedAt, nowMs)} · hub {snapshot.hubVersion}
          </span>
        }
      />

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
            <Card>
              <EmptyState compact data-testid="detail-empty" title="Select a machine on the map or in the list to see its history and T3 threads." />
            </Card>
          )}
        </aside>
      </div>
    </section>
  );
}
