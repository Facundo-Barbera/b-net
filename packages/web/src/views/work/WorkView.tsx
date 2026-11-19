import type { ReactNode } from "react";
import { WORK_RECENT_HOURS, HubRoutes, type WorkItem, type WorkSnapshot } from "@b-net/core";
import type { BoardState } from "../../data/useSnapshot.ts";
import { BoardEvents } from "../board/BoardEvents.tsx";
import { BoardGap } from "../board/BoardGap.tsx";
import { BoardTaskList } from "../board/BoardTasks.tsx";
import { OPEN_ORDER } from "../board/meta.ts";
import "../board/board.css";
import { Callout, EmptyState, PageHeader, useNow } from "../../components/index.ts";
import type { ViewProps } from "../../routes.tsx";
import { WorkSourceGap } from "../shared/WorkSourceGap.tsx";
import { FleetStrip } from "./FleetStrip.tsx";
import { machineName } from "./kinds.ts";
import { RunningRow, TimelineItem, WaitingCard } from "./WorkItemView.tsx";
import { WorkPulse } from "./WorkPulse.tsx";
import "./work.css";

function Section({ id, title, count, hint, className, children }: { id: string; title: string; count?: number; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`wk-section${className ? ` ${className}` : ""}`} aria-labelledby={`wk-${id}`} data-testid={`section-${id}`}>
      <header className="wk-section__head">
        <h2 id={`wk-${id}`} className="wk-section__title">
          {title}
          {count !== undefined && <span className="wk-count num">{count}</span>}
        </h2>
        {hint != null && <p className="wk-section__hint">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/** Running items grouped by project, keeping the longest-running project first. */
function byProject(items: WorkItem[]) {
  const groups = new Map<string, { name: string; key: string; items: WorkItem[] }>();
  for (const i of items) {
    const g = groups.get(i.project.key) ?? { name: i.project.name, key: i.project.key, items: [] };
    g.items.push(i);
    groups.set(i.project.key, g);
  }
  return [...groups.values()];
}

/** Local-time greeting for the page eyebrow; exported for tests. */
export function greeting(nowMs: number): string {
  const h = new Date(nowMs).getHours();
  if (h >= 6 && h < 13) return "Buenos días";
  if (h >= 13 && h < 20) return "Buenas tardes";
  return "Buenas noches";
}

const BOARD_TASKS_MAX = 12;
const BOARD_EVENTS_MAX = 8;

/** Open Board tasks across projects (blocked, running, queued) and the latest bot notices. */
function boardLists(board: BoardState) {
  const projects = board.data?.projects ?? [];
  const tasks = projects
    .flatMap((p) => p.tasks.filter((t) => t.state !== "listo").map((task) => ({ task, project: { slug: p.slug, name: p.name } })))
    .sort((a, b) => OPEN_ORDER.indexOf(a.task.state) - OPEN_ORDER.indexOf(b.task.state) || b.task.updatedAt.localeCompare(a.task.updatedAt));
  const events = projects.flatMap((p) => p.events.map((event) => ({ event, name: p.name }))).sort((a, b) => b.event.at.localeCompare(a.event.at));
  return { tasks, events };
}

function BoardTasksSection({ board }: { board: BoardState }) {
  const { tasks } = boardLists(board);
  return (
    <section className="wk-section" aria-labelledby="wk-board" data-testid="board-tasks">
      <header className="wk-section__head">
        <h2 id="wk-board" className="wk-section__title">
          Tablero
          <span className="wk-count num">{tasks.length}</span>
        </h2>
        <p className="wk-section__hint">Tareas abiertas de los proyectos: bloqueadas primero, luego en curso y en espera.</p>
      </header>
      <BoardGap board={board} />
      {board.data && (tasks.length > 0 ? (
        <BoardTaskList tasks={tasks.slice(0, BOARD_TASKS_MAX)} />
      ) : (
        <EmptyState compact data-testid="board-tasks-empty" title="Sin tareas abiertas en el tablero." />
      ))}
    </section>
  );
}

function BoardEventsSection({ board }: { board: BoardState }) {
  const { events } = boardLists(board);
  if (!board.data) return null;
  return (
    <section className="wk-section" aria-labelledby="wk-board-events" data-testid="board-events">
      <header className="wk-section__head">
        <h2 id="wk-board-events" className="wk-section__title">
          Avisos de bots
          <span className="wk-count num">{events.length}</span>
        </h2>
        <p className="wk-section__hint">Preguntas, bloqueos e hilos terminados que despiertan al bot de cada proyecto.</p>
      </header>
      {events.length > 0 ? <BoardEvents events={events.slice(0, BOARD_EVENTS_MAX)} /> : <EmptyState compact title="Sin avisos." />}
    </section>
  );
}

function Body({ work, snapshot, board }: { work: WorkSnapshot; snapshot: ViewProps["snapshot"]; board?: BoardState }) {
  const src = work.sources;
  const name = (id: string | null) => machineName(snapshot.machines, id);
  const threadsDown = src.threads !== "ok";

  return (
    <div className="wk-layout">
      <div className="wk-layout__main">
        <Section
          id="waiting"
          title="Te espera"
          count={work.waiting.length}
          className="wk-section--queue"
          hint="Lo más urgente primero: hilos bloqueados en tu respuesta y runs que fallaron."
        >
          {work.waiting.length > 0 ? (
            <ol className="wk-waitlist">
              {work.waiting.map((i, n) => (
                <li key={i.id}>
                  <WaitingCard item={i} machine={name(i.machineId)} rank={n + 1} />
                </li>
              ))}
            </ol>
          ) : threadsDown ? (
            <WorkSourceGap kind="threads" state={src.threads} testId="gap-waiting-threads" />
          ) : (
            <EmptyState compact className="wk-clear" data-testid="waiting-empty" title="Nada te espera." description="Cuando un hilo pida tu respuesta o un run falle, aparece aquí primero." />
          )}
          {src.pullRequests !== "ok" && <WorkSourceGap kind="pullRequests" state={src.pullRequests} testId="gap-waiting-prs" />}
        </Section>

        <Section id="running" title="En curso" count={work.running.length} hint="Hilos de T3 corriendo ahora, por proyecto, con su tiempo de run y su máquina.">
          {work.running.length > 0 ? (
            <div className="wk-groups">
              {byProject(work.running).map((g) => (
                <section key={g.key} className="wk-group" aria-label={`En curso en ${g.name}`}>
                  <h3 className="wk-group__title">
                    <a className="wk-project" href={`#/projects/${encodeURIComponent(g.key)}`}>{g.name}</a>
                    <span className="wk-count num">{g.items.length}</span>
                  </h3>
                  <ul className="wk-rows">
                    {g.items.map((i) => <RunningRow key={i.id} item={i} machine={name(i.machineId)} />)}
                  </ul>
                </section>
              ))}
            </div>
          ) : threadsDown ? (
            <WorkSourceGap kind="threads" state={src.threads} testId="gap-running-threads" />
          ) : (
            <EmptyState compact data-testid="running-empty" title="Nada corriendo ahora." description="Los runs que arranques en T3 se ven aquí con su tiempo." />
          )}
        </Section>
        {board && <BoardTasksSection board={board} />}
      </div>

      <div className="wk-layout__rail">
        <Section id="done" title="Listo hace poco" count={work.done.length} hint={`Hilos terminados, entregables y PRs de las últimas ${WORK_RECENT_HOURS} h.`}>
          {work.done.length > 0 ? (
            <ol className="wk-tl">
              {work.done.map((i) => <TimelineItem key={i.id} item={i} machine={name(i.machineId)} />)}
            </ol>
          ) : (
            <EmptyState compact data-testid="done-empty" title={`Nada terminado en las últimas ${WORK_RECENT_HOURS} h.`} />
          )}
          {threadsDown && work.done.length > 0 && <WorkSourceGap kind="threads" state={src.threads} testId="gap-done-threads" />}
          {src.projects !== "ok" && <WorkSourceGap kind="projects" state={src.projects} testId="gap-done-projects" />}
        </Section>
        {board && <BoardEventsSection board={board} />}
        <FleetStrip snapshot={snapshot} />
      </div>
    </div>
  );
}

/**
 * Default view, a work center rather than a report: a greeting and four pulse tiles (te espera, en curso,
 * listo, flota), then the queue that needs Facundo and the running lanes on the left, and on the right rail
 * what landed recently and the fleet at a glance. Order in the DOM follows urgency for keyboard and readers.
 */
export function WorkView({ snapshot, work, board }: ViewProps) {
  const now = useNow();
  const data = work.data;
  const subtitle = data ? (
    <span className="num">
      {data.waiting.length} te esperan · {data.running.length} en curso · {data.done.length} listos
    </span>
  ) : null;

  return (
    <section className="ui-view wk" data-testid="view-work" aria-labelledby="wk-title">
      <PageHeader eyebrow={`${greeting(now)}, Facundo`} title="Trabajo" titleId="wk-title" subtitle={subtitle} />
      {data && work.error && (
        <Callout tone="warn" role="alert">Mostrando el último estado de trabajo: falló la actualización ({work.error})</Callout>
      )}
      {data ? (
        <>
          <WorkPulse work={data} snapshot={snapshot} />
          <Body work={data} snapshot={snapshot} board={board} />
        </>
      ) : (
        <>
          {work.error ? (
            <EmptyState role="alert" data-testid="work-error" title="El hub no entrega la vista de trabajo" description={`${HubRoutes.work}: ${work.error}`}>
              <p className="ui-empty__how">
                <span className="ui-label">Revisa</span> que el hub esté actualizado (esta ruta llegó con la pantalla Trabajo).
              </p>
            </EmptyState>
          ) : (
            <EmptyState role="status" data-testid="work-loading" title="Cargando trabajo…" />
          )}
          <FleetStrip snapshot={snapshot} />
        </>
      )}
    </section>
  );
}
