import { useState } from "react";
import type { HubSnapshot } from "@b-net/core";
import { Callout, Card, EmptyState, PageHeader, StatusDot, useNow } from "../../components/index.ts";
import { SOURCE_SETUP, metricsCoverage } from "../../data/sources.ts";
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

/**
 * One notice for the whole fleet when some machines have no metrics source: how many, whether Beszel is
 * connected, how many agents, and how to connect them. Cards then only carry a short per-machine reason.
 */
function CoverageNotice({ snapshot }: { snapshot: HubSnapshot }) {
  const c = metricsCoverage(snapshot);
  if (c.without.length === 0) return null;
  const beszel = c.beszel === "missing" ? "no conectado" : c.beszel === "failing" ? "no responde" : "conectado";
  return (
    <Callout tone="neutral" role="note" icon={<StatusDot tone="dormant" />} data-testid="metrics-coverage" className="mv-coverage">
      <p>
        <strong>{c.without.length} de {c.total} máquinas sin fuente de métricas</strong>
        <span className="u-muted"> ({c.without.map((m) => m.name).join(", ")})</span>
      </p>
      <p className="u-muted num">Beszel: {beszel} · agentes: {c.agents} de {c.total}</p>
      <p className="u-muted">
        <span className="ui-label">Cómo conectarlas</span> {SOURCE_SETUP.beszel.connect} O bien: {SOURCE_SETUP.agent.connect}
      </p>
    </Callout>
  );
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
        subtitle={<span className="num">{machines.length} máquinas en el tailnet · hub {snapshot.hubMachineId}</span>}
      />

      <SummaryStrip summary={summary} />
      <CoverageNotice snapshot={snapshot} />

      <Topology machines={machines} hubId={snapshot.hubMachineId} selectedId={selected} onSelect={setSelected} />

      <div className="mv-main">
        <div className="mv-cards" role="list" aria-label="Máquinas">
          {machines.map((m) => (
            <div role="listitem" key={m.id}>
              <MachineCard m={m} isHub={m.id === snapshot.hubMachineId} selected={selected === m.id} nowMs={nowMs} sources={snapshot.sources} onSelect={() => setSelected(m.id)} />
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
              <EmptyState compact data-testid="detail-empty" title="Elige una máquina en el mapa o en la lista para ver su historial y sus hilos de T3." />
            </Card>
          )}
        </aside>
      </div>
    </section>
  );
}
