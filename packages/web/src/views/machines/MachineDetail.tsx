import { useState } from "react";
import type { MachineView, SourceHealth, T3ThreadView } from "@bixku/core";
import { GROUP_TITLE, OS_LABEL, ROLE_LABEL, STATUS_LABEL, STATUS_TONE, THREAD_TONE, groupThreads, type ThreadNode } from "./derive.ts";
import { relTime, since } from "./format.ts";
import { Dot, Sparkline } from "./parts.tsx";

function ThreadRow({ node, nowMs }: { node: ThreadNode; nowMs: number }) {
  const t = node.thread;
  const modelLine = [t.provider, t.model].filter(Boolean).join(" · ");
  const badRun = t.lastRunStatus === "failed" || t.lastRunStatus === "interrupted" || t.lastRunStatus === "cancelled";
  return (
    <li className="mv-thread" data-testid={`thread-${t.id}`} data-state={t.state}>
      <div className="mv-thread__main">
        <Dot tone={THREAD_TONE[t.state]} />
        <span className="mv-thread__title">{t.title}</span>
        {t.state === "active" && t.runningSince && <span className="mv-chip" data-tone="ok">running {since(t.runningSince, nowMs)}</span>}
        {t.state === "waiting" && <span className="mv-chip" data-tone="warn">needs you</span>}
        {badRun && t.state !== "active" && <span className="mv-chip" data-tone={t.lastRunStatus === "failed" ? "danger" : "idle"}>last run {t.lastRunStatus}</span>}
      </div>
      <div className="mv-thread__meta">
        {t.projectTitle && <span>{t.projectTitle}</span>}
        {modelLine && <span className="num">{modelLine}</span>}
        {t.branch && <span className="num">⎇ {t.branch}</span>}
        <span>updated {relTime(t.updatedAt, nowMs)}</span>
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
        <h3 className="mv-label">T3 threads · {visible}</h3>
        {archived > 0 && (
          <button type="button" className="mv-btn" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? "Hide" : "Show"} archived ({archived})
          </button>
        )}
      </div>
      {groups.length === 0 && <p className="mv-empty">No T3 threads on this machine{archived > 0 ? " (only archived)" : ""}.</p>}
      {groups.map((g) => (
        <section key={g.state} className="mv-group" data-state={g.state} aria-label={`${GROUP_TITLE[g.state]} threads`}>
          <h4 className="mv-group__title" data-tone={THREAD_TONE[g.state]}>
            <Dot tone={THREAD_TONE[g.state]} />
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
  const tone = STATUS_TONE[m.status];
  const h = m.history;
  const t3Down = sources.find((s) => s.source === "t3" && s.machineId === m.id && !s.ok);
  return (
    <section className="mv-panel mv-detailpanel" aria-label={`${m.name} details`} data-testid="machine-detail" data-machine={m.id}>
      <header className="mv-panel__head">
        <div>
          <h2 className="mv-detail__name"><Dot tone={tone} />{m.name}</h2>
          <p className="mv-card__sub">{STATUS_LABEL[m.status]} · {ROLE_LABEL[m.role]} · {OS_LABEL[m.os]}</p>
        </div>
        <button type="button" className="mv-btn" onClick={onClose}>Close</button>
      </header>

      <div className="mv-sparks">
        {h ? (
          <>
            <div><span className="mv-label">CPU</span><Sparkline values={h.cpuPct} stepSec={h.stepSec} label="CPU" series={1} /></div>
            <div><span className="mv-label">RAM</span><Sparkline values={h.memPct} stepSec={h.stepSec} label="RAM" series={2} /></div>
          </>
        ) : (
          <p className="mv-empty">No metric history{m.status === "offline" ? " (machine offline)" : m.metricsSource === "none" ? " (no metrics source)" : ""}.</p>
        )}
      </div>

      {t3Down && (
        <p className="mv-card__note" data-tone="warn" role="alert">
          T3 source unreachable{t3Down.error ? `: ${t3Down.error}` : ""}. Last success {relTime(t3Down.lastSuccessAt, nowMs)}; thread list may be out of date.
        </p>
      )}
      <Threads key={m.id} threads={threads} nowMs={nowMs} />
    </section>
  );
}
