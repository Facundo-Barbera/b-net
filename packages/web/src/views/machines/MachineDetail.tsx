import { useState } from "react";
import type { MachineView, SourceHealth, T3ThreadView } from "@bixku/core";
import { Badge, Callout, Card, EmptyState, Sparkline, StatusDot, toneForMachineStatus, toneForThreadState } from "../../components/index.ts";
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
  return `${name} history, last ${minutes} min: now ${r(values[n - 1]!)}%, average ${r(avg)}%, min ${r(Math.min(...values))}%, max ${r(Math.max(...values))}%`;
}

function History({ name, values, stepSec, series }: { name: string; values: readonly number[]; stepSec: number; series: 1 | 2 }) {
  return (
    <div>
      <span className="ui-label">{name}</span>
      <Sparkline className="mv-spark" values={values} width={160} height={40} min={0} max={100} series={series} stretch refLine={USAGE_WARN_AT}
        label={values.length >= 2 ? historyLabel(name, values, stepSec) : `${name} history: no data`} />
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
        {t.state === "active" && t.runningSince && <Badge tone="ok">running {since(t.runningSince, nowMs)}</Badge>}
        {t.state === "waiting" && <Badge tone="warn">needs you</Badge>}
        {badRun && t.state !== "active" && <Badge tone={t.lastRunStatus === "failed" ? "danger" : "idle"}>last run {t.lastRunStatus}</Badge>}
      </div>
      <div className="mv-thread__meta">
        {t.projectTitle && <span>{t.projectTitle}</span>}
        {modelLine && <span className="num">{modelLine}</span>}
        {t.branch && <span className="num">⎇ {t.branch}</span>}
        <span>updated {ago(t.updatedAt, nowMs)}</span>
        {node.parentElsewhere && <span className="mv-thread__parent">↳ subagent of “{node.parentElsewhere.title}”</span>}
      </div>
      {node.children.length > 0 && (
        <ul className="mv-thread__children" aria-label={`Subagents of ${t.title}`}>
          {node.children.map((c) => <ThreadRow key={c.thread.id} node={c} nowMs={nowMs} />)}
        </ul>
      )}
    </li>
  );
}

function Threads({ threads, nowMs }: { threads: T3ThreadView[]; nowMs: number }) {
  const [showArchived, setShowArchived] = useState(false);
  const archived = threads.filter((t) => t.state === "archived").length;
  const groups = groupThreads(threads, showArchived);
  const visible = threads.length - (showArchived ? 0 : archived);
  return (
    <div className="mv-threads">
      <div className="mv-threads__head">
        <h3 className="ui-label">T3 threads · {visible}</h3>
        {archived > 0 && (
          <button type="button" className="mv-btn" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide" : "Show"} archived ({archived})
          </button>
        )}
      </div>
      {groups.length === 0 && <EmptyState compact title={`No T3 threads on this machine${archived > 0 ? " (only archived)" : ""}.`} />}
      {groups.map((g) => (
        <section key={g.state} className="mv-group" data-state={g.state} aria-label={`${GROUP_TITLE[g.state]} threads`}>
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
    <Card className="mv-detailpanel" bodyClassName="mv-detail__body" aria-label={`${m.name} details`} data-testid="machine-detail" data-machine={m.id}>
      <header className="mv-detail__head">
        <div>
          <h2 className="mv-detail__name"><StatusDot tone={tone} />{m.name}</h2>
          <p className="mv-card__sub">{STATUS_LABEL[m.status]} · {ROLE_LABEL[m.role]} · {OS_LABEL[m.os]}</p>
        </div>
        <button type="button" className="mv-btn" onClick={onClose}>Close</button>
      </header>

      {h ? (
        <div className="mv-sparks">
          <History name="CPU" values={h.cpuPct} stepSec={h.stepSec} series={1} />
          <History name="RAM" values={h.memPct} stepSec={h.stepSec} series={2} />
        </div>
      ) : (
        <EmptyState compact title={`No metric history${m.status === "offline" ? " (machine offline)" : m.metricsSource === "none" ? " (no metrics source)" : ""}.`} />
      )}

      {t3Down && (
        <Callout tone="warn" role="alert">
          T3 source unreachable{t3Down.error ? `: ${t3Down.error}` : ""}. Last success {ago(t3Down.lastSuccessAt, nowMs)}; thread list may be out of date.
        </Callout>
      )}
      <Threads key={m.id} threads={threads} nowMs={nowMs} />
    </Card>
  );
}
