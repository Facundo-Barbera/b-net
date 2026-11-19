import { prTitle, t3ThreadHref, type MachineView, type ProjectWork, type ThreadState, type WorkSnapshot } from "@b-net/core";
import {
  ActionLink,
  ArrowLeftIcon,
  Badge,
  BranchIcon,
  Card,
  EmptyState,
  PullRequestIcon,
  RelativeTime,
  StatusDot,
  Tag,
  toneForThreadState,
} from "../../components/index.ts";
import type { BoardState, DataMode } from "../../data/useSnapshot.ts";
import { spanEs } from "../../lib/spanish.ts";
import { WorkSourceGap } from "../shared/WorkSourceGap.tsx";
import { machineName } from "../work/kinds.ts";
import { EventRow, RunningRow } from "../work/WorkItemView.tsx";
import { BoardGap } from "../board/BoardGap.tsx";
import { BoardEventsCard, BoardPrList, BoardTasksCard, BoardUpdatesCard } from "../board/BoardProjectPanel.tsx";
import { DeliverablesPanel } from "./DeliverablesPanel.tsx";
import { Counters } from "./Counters.tsx";

const THREAD_STATE: Record<ThreadState, string> = {
  active: "corriendo",
  waiting: "te espera",
  idle: "lista",
  dormant: "dormida",
  archived: "archivada",
};

export interface ProjectDetailProps {
  project: ProjectWork;
  work: WorkSnapshot;
  mode: DataMode;
  machines: readonly MachineView[];
  selectedDeliverableId: string | null;
  /** Board read through the hub; its project is matched by slug (the registered project id). */
  board?: BoardState;
}

/**
 * One project: what needs Facundo and what runs now, its deliverables with the embedded viewer, then its T3
 * threads, PRs, branches and tasks. Sources that are not connected say so in place.
 */
export function ProjectDetail({ project: p, work, mode, machines, selectedDeliverableId, board }: ProjectDetailProps) {
  const key = p.ref.key;
  const onBoard = board?.data?.projects.find((b) => b.slug === key) ?? null;
  const name = (id: string | null) => machineName(machines, id);
  const waiting = work.waiting.filter((i) => i.project.key === key);
  const running = work.running.filter((i) => i.project.key === key);
  const done = work.done.filter((i) => i.project.key === key);
  const threads = work.threads.filter((t) => t.projectKey === key);
  const prs = work.prs.filter((pr) => pr.projectKey === key);
  const branches = [...new Map(threads.filter((t) => t.branch).map((t) => [t.branch!, t])).values()];
  const active = waiting.length + running.length;

  return (
    <section className="ui-view pj pj-detail" data-testid="view-projects" aria-labelledby="pj-title">
      <a className="pj-back" href="#/projects">
        <ArrowLeftIcon /> Proyectos
      </a>
      <header className="pj-hero">
        <div className="pj-hero__title">
          <h1 id="pj-title">{p.ref.name}</h1>
          {p.registered ? <Badge tone="accent" variant="outline">registrado</Badge> : <Badge variant="outline">desde T3</Badge>}
        </div>
        {p.description && <p className="pj-hero__desc">{p.description}</p>}
        <Counters p={p} />
      </header>

      {active > 0 && (
        <section className="wk-section" aria-labelledby="pj-now">
          <h2 id="pj-now" className="wk-section__title">Ahora</h2>
          <ul className="wk-rows wk-rows--card" data-testid="project-now">
            {waiting.map((i) => <EventRow key={i.id} item={i} machine={name(i.machineId)} showProject={false} />)}
            {running.map((i) => <RunningRow key={i.id} item={i} machine={name(i.machineId)} />)}
          </ul>
        </section>
      )}

      <div className="pj-grid">
        <div className="pj-grid__main">
          {onBoard && <BoardUpdatesCard project={onBoard} />}
          {onBoard && <BoardEventsCard project={onBoard} />}
          {p.registered && p.ref.projectId ? (
            <DeliverablesPanel
              projectId={p.ref.projectId}
              mode={mode}
              version={`${p.counts.deliverables}:${p.lastActivityAt ?? ""}`}
              selectedId={selectedDeliverableId}
            />
          ) : (
            <Card title="Entregables" data-testid="deliverables">
              <EmptyState
                compact
                title="Este proyecto viene de T3 y no está registrado en el hub."
                description="Regístralo (POST /api/v1/projects con grouping.t3ProjectTitles) para que los bots publiquen sus entregables aquí."
              />
            </Card>
          )}

          {done.length > 0 && (
            <Card title="Listo hace poco" subtitle={done.length} flush>
              <ul className="wk-rows">
                {done.map((i) => <EventRow key={i.id} item={i} machine={name(i.machineId)} showProject={false} />)}
              </ul>
            </Card>
          )}
        </div>

        <div className="pj-grid__side">
          <Card title="Hilos de T3" subtitle={threads.length} flush data-testid="project-threads">
            {threads.length > 0 ? (
              <ul className="pj-threads">
                {threads.map((t) => (
                  <li key={`${t.machineId}:${t.id}`} className="pj-thread" data-state={t.state}>
                    <StatusDot tone={toneForThreadState(t.state)} pulse={t.state === "active"} />
                    <div className="pj-thread__main">
                      <a className="pj-thread__title" href={t3ThreadHref(t.machineId, t.id)} aria-label={`Abrir en T3: ${t.title}`}>
                        {t.title}
                      </a>
                      <span className="wk-meta">
                        <span>{THREAD_STATE[t.state]}</span>
                        <span className="num">{name(t.machineId)}</span>
                        <RelativeTime className="num" value={t.updatedAt} format={spanEs} />
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : work.sources.threads !== "ok" ? (
              <div className="pj-pad"><WorkSourceGap kind="threads" state={work.sources.threads} /></div>
            ) : (
              <EmptyState compact className="pj-pad" title="Sin hilos de T3 en este proyecto." />
            )}
          </Card>

          <Card title="PRs" subtitle={prs.length + (onBoard?.prs.length ?? 0)} flush data-testid="project-prs">
            {onBoard && <BoardPrList project={onBoard} />}
            {prs.length > 0 && (
              <ul className="pj-threads">
                {prs.map((pr) => (
                  <li key={pr.url} className="pj-thread">
                    <PullRequestIcon className="pj-thread__icon" />
                    <div className="pj-thread__main">
                      <span className="pj-thread__title num">{prTitle(pr.url)}</span>
                      <span className="wk-meta">
                        <span>enlazado en «{pr.deliverableTitle}»</span>
                        <RelativeTime className="num" value={pr.lastSeenAt} format={spanEs} />
                      </span>
                    </div>
                    <ActionLink href={pr.url} external>Ver</ActionLink>
                  </li>
                ))}
              </ul>
            )}
            <div className="pj-pad">
              {prs.length === 0 && work.sources.pullRequests === "ok" ? (
                <EmptyState compact title="Sin PRs." />
              ) : (
                <WorkSourceGap kind="pullRequests" state={work.sources.pullRequests} testId="gap-project-prs" />
              )}
            </div>
          </Card>

          <Card title="Actividad git" flush data-testid="project-git">
            {branches.length > 0 && (
              <ul className="pj-threads" aria-label="Ramas vistas en hilos de T3">
                {branches.map((t) => (
                  <li key={t.branch} className="pj-thread">
                    <BranchIcon className="pj-thread__icon" />
                    <div className="pj-thread__main">
                      <Tag>{t.branch}</Tag>
                      <span className="wk-meta"><span>en «{t.title}»</span></span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="pj-pad">
              <WorkSourceGap kind="git" state={work.sources.git} testId="gap-project-git" />
            </div>
          </Card>

          {onBoard ? (
            <BoardTasksCard project={onBoard} />
          ) : (
            <Card title="Tareas" data-testid="project-tasks">
              {board && (board.missing || board.error) ? <BoardGap board={board} /> : <WorkSourceGap kind="tasks" state={work.sources.tasks} testId="gap-project-tasks" />}
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}
