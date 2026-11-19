import { useState } from "react";
import type { MachineView, SourceHealth, T3ThreadView } from "@fhub/core";
import { Badge, Callout, Card, EmptyState, Sparkline, StatusDot, toneForMachineStatus, toneForThreadState } from "../../components/index.ts";
import { SOURCE_SETUP, missingMetricsReason, sourceStatus } from "../../data/sources.ts";
import { formatDuration } from "../../lib/format.ts";
import { USAGE_WARN_AT } from "../../lib/thresholds.ts";
import { GROUP_TITLE, OS_LABEL, ROLE_LABEL, STATUS_LABEL, ago, groupThreads, type ThreadNode } from "./derive.ts";

/** Elapsed since an ISO start time, e.g. "14m". */
const since = (iso: string, nowMs: number) => formatDuration((nowMs - Date.parse(iso)) / 1000);

/** Accessible description of a 0–100 history series (the chart itself is drawn by `Sparkline`). */
function historyLabel(name: string, values: readonly number[], stepSec: number): string {
  const n = values.length;
  const minutes = Math.round((stepSec * (n - 1)) / 60);
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const r = Math.round;
  return `Historial de ${name}, últimos ${minutes} min: ahora ${r(values[n - 1]!)}%, promedio ${r(avg)}%, mínimo ${r(Math.min(...values))}%, máximo ${r(Math.max(...values))}%`;
}

function History({ name, values, stepSec, series }: { name: string; values: readonly number[]; stepSec: number; series: 1 | 2 }) {
  return (
    <div>
      <span className="ui-label">{name}</span>
      <Sparkline className="mv-spark" values={values} width={160} height={40} min={0} max={100} series={series} stretch refLine={USAGE_WARN_AT}
        label={values.length >= 2 ? historyLabel(name, values, stepSec) : `Historial de ${name}: sin datos`} />
    </div>
  );
}

function ThreadRow({ node, nowMs }: { node: ThreadNode; nowMs: number }) {
  const t = node.thread;
  const modelLine = [t.provider, t.model].filter(Boolean).join(" · ");
  const badRun = t.lastRunStatus === "failed" || t.lastRunStatus === "interrupted" || t.lastRunStatus === "cancelled";
  return (
    <li className="mv-thread" data-testid={`thread-${t.id}`} data-state={t.state}>
      <div className="mv-thread__main">
        <StatusDot tone={toneForThreadState(t.state)} />
        <span className="mv-thread__title">{t.title}</span>
        {t.state === "active" && t.runningSince && <Badge dot tone="ok">corriendo {since(t.runningSince, nowMs)}</Badge>}
        {t.state === "waiting" && <Badge dot tone="warn">te necesita</Badge>}
        {badRun && t.state !== "active" && <Badge dot tone={t.lastRunStatus === "failed" ? "danger" : "idle"}>último run {t.lastRunStatus}</Badge>}
      </div>
      <div className="mv-thread__meta">
        {t.projectTitle && <span>{t.projectTitle}</span>}
        {modelLine && <span className="num">{modelLine}</span>}
        {t.branch && <span className="num">⎇ {t.branch}</span>}
        <span>actualizado {ago(t.updatedAt, nowMs)}</span>
        {node.parentElsewhere && <span className="mv-thread__parent">↳ subagente de “{node.parentElsewhere.title}”</span>}
      </div>
      {node.children.length > 0 && (
        <ul className="mv-thread__children" aria-label={`Subagentes de ${t.title}`}>
          {node.children.map((c) => <ThreadRow key={c.thread.id} node={c} nowMs={nowMs} />)}
        </ul>
      )}
    </li>
  );
}

/** Empty thread list: no T3 source for the machine, a failing one, or genuinely no threads. */
function NoThreads({ machineId, sources, onlyArchived }: { machineId: string; sources: readonly SourceHealth[]; onlyArchived: boolean }) {
  const t3 = sourceStatus(sources, "t3", machineId);
  if (t3.state === "missing") {
    return (
      <EmptyState compact data-testid="threads-empty" data-source-state="missing" title="T3 no está conectado en esta máquina."
        description={SOURCE_SETUP.t3.connect} />
    );
  }
  return <EmptyState compact data-testid="threads-empty" data-source-state={t3.state} title={`Sin hilos de T3 en esta máquina${onlyArchived ? " (solo archivados)" : ""}.`} />;
}

function Threads({ machineId, threads, sources, nowMs }: { machineId: string; threads: T3ThreadView[]; sources: readonly SourceHealth[]; nowMs: number }) {
  const [showArchived, setShowArchived] = useState(false);
  const archived = threads.filter((t) => t.state === "archived").length;
  const groups = groupThreads(threads, showArchived);
  const visible = threads.length - (showArchived ? 0 : archived);
  return (
    <div className="mv-threads">
      <div className="mv-threads__head">
        <h3 className="ui-label">Hilos de T3 · {visible}</h3>
        {archived > 0 && (
          <button type="button" className="mv-btn" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Ocultar" : "Mostrar"} archivados ({archived})
          </button>
        )}
      </div>
      {groups.length === 0 && <NoThreads machineId={machineId} sources={sources} onlyArchived={archived > 0} />}
      {groups.map((g) => (
        <section key={g.state} className="mv-group" data-state={g.state} aria-label={`Hilos ${GROUP_TITLE[g.state]}`}>
          <h4 className={`mv-group__title tone-${toneForThreadState(g.state)}`}>
            <StatusDot tone={toneForThreadState(g.state)} />
            {GROUP_TITLE[g.state]} <span className="num">{g.count}</span>
          </h4>
          <ul>{g.nodes.map((n) => <ThreadRow key={n.thread.id} node={n} nowMs={nowMs} />)}</ul>
        </section>
      ))}
    </div>
  );
}

export function MachineDetail({
  machine: m, threads, sources, nowMs, onClose,
}: { machine: MachineView; threads: T3ThreadView[]; sources: SourceHealth[]; nowMs: number; onClose: () => void }) {
  const tone = toneForMachineStatus(m.status);
  const h = m.history;
  const t3Down = sources.find((s) => s.source === "t3" && s.machineId === m.id && !s.ok);
  return (
    <Card className="mv-detailpanel" bodyClassName="mv-detail__body" aria-label={`Detalle de ${m.name}`} data-testid="machine-detail" data-machine={m.id}>
      <header className="mv-detail__head">
        <div>
          <h2 className="mv-detail__name">{m.name}</h2>
          <p className="mv-card__sub">
            <Badge dot tone={tone}>{STATUS_LABEL[m.status]}</Badge> {ROLE_LABEL[m.role]} · {OS_LABEL[m.os]}
          </p>
        </div>
        <button type="button" className="mv-btn" onClick={onClose}>Cerrar</button>
      </header>

      {h ? (
        <div className="mv-sparks">
          <History name="CPU" values={h.cpuPct} stepSec={h.stepSec} series={1} />
          <History name="RAM" values={h.memPct} stepSec={h.stepSec} series={2} />
        </div>
      ) : (
        <EmptyState
          compact
          data-testid="history-empty"
          title={`Sin historial de métricas${m.status === "offline" ? " (máquina offline)" : m.metricsSource === "none" ? ": sin fuente de métricas" : ""}.`}
          description={m.metricsSource === "none" ? `${missingMetricsReason(m, sources)}. ${SOURCE_SETUP.beszel.connect}` : undefined}
        />
      )}

      {t3Down && (
        <Callout tone="warn" role="alert">
          La fuente T3 no responde{t3Down.error ? `: ${t3Down.error}` : ""}. Último dato {ago(t3Down.lastSuccessAt, nowMs)}; la lista de hilos puede estar desactualizada.
        </Callout>
      )}
      <Threads key={m.id} machineId={m.id} threads={threads} sources={sources} nowMs={nowMs} />
    </Card>
  );
}
