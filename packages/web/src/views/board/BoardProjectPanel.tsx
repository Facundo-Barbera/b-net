import type { BoardProjectView } from "@b-net/core";
import { ActionLink, Badge, Card, EmptyState, PullRequestIcon, RelativeTime } from "../../components/index.ts";
import { spanEs } from "../../lib/spanish.ts";
import { BoardEvents } from "./BoardEvents.tsx";
import { BoardTaskList } from "./BoardTasks.tsx";
import { PR_STATE_META } from "./meta.ts";
import "./board.css";

/** Updates (`<slug>/avances`) and the HTML summaries the hub already stores, newest first. */
export function BoardUpdatesCard({ project }: { project: BoardProjectView }) {
  const { updates, summaries, slug } = project;
  return (
    <Card title="Avances" subtitle={updates.length} flush data-testid="project-board-updates">
      {updates.length > 0 ? (
        <ul className="bd-list">
          {updates.map((u) => (
            <li key={u.id} className="bd-item">
              <span className="bd-item__text">{u.text}</span>
              <span className="wk-meta">
                <span>{u.author}</span>
                <RelativeTime className="num" value={u.at} format={spanEs} />
                {u.link && (
                  <a href={u.link} target="_blank" rel="noopener noreferrer">
                    enlace
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact className="pj-pad" title={`Sin avances en ${slug}/avances.`} />
      )}
      {summaries.length > 0 && (
        <ul className="bd-list" aria-label="Resúmenes HTML">
          {summaries.map((s) => (
            <li key={s.id} className="bd-item">
              <a className="bd-item__text" href={`#/projects/${encodeURIComponent(slug)}/d/${encodeURIComponent(s.id)}`}>
                {s.title}
              </a>
              <span className="wk-meta">
                <span>resumen HTML</span>
                <RelativeTime className="num" value={s.at} format={spanEs} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Bot notices for one project. */
export function BoardEventsCard({ project }: { project: BoardProjectView }) {
  return (
    <Card title="Avisos de bots" subtitle={project.events.length} data-testid="project-board-events">
      {project.events.length > 0 ? (
        <BoardEvents events={project.events.map((event) => ({ event }))} showProject={false} />
      ) : (
        <EmptyState compact title={`Sin avisos en ${project.slug}/eventos.`} />
      )}
    </Card>
  );
}

/** Tasks of one project, open first, then the last finished. */
export function BoardTasksCard({ project }: { project: BoardProjectView }) {
  const open = project.tasks.filter((t) => t.state !== "listo").length;
  return (
    <Card title="Tareas" subtitle={`${open} abiertas`} flush data-testid="project-tasks">
      {project.tasks.length > 0 ? (
        <BoardTaskList tasks={project.tasks.map((task) => ({ task }))} testId="project-board-tasks" />
      ) : (
        <EmptyState compact className="pj-pad" title={`Sin tareas en ${project.slug}/tareas.`} />
      )}
    </Card>
  );
}

/** PRs the orchestrator published on the board (`pr=` label), with their state in a word and a glyph. */
export function BoardPrList({ project }: { project: BoardProjectView }) {
  if (project.prs.length === 0) return null;
  return (
    <ul className="bd-list" aria-label="PRs en el tablero" data-testid="project-board-prs">
      {project.prs.map((pr) => {
        const m = PR_STATE_META[pr.state];
        return (
          <li key={pr.ref} className="bd-pr">
            <PullRequestIcon className="pj-thread__icon" />
            <div className="pj-thread__main">
              <span className="pj-thread__title">{pr.title}</span>
              <span className="wk-meta">
                <span className="num">{pr.ref}</span>
                <Badge tone={m.tone} dot variant="outline">{m.label}</Badge>
                <RelativeTime className="num" value={pr.updatedAt} format={spanEs} />
              </span>
            </div>
            <ActionLink href={pr.url} external aria-label={`Ver PR ${pr.ref}`}>Ver</ActionLink>
          </li>
        );
      })}
    </ul>
  );
}
