import { prUrlOf, type BoardTaskView } from "@b-net/core";
import { Badge, RelativeTime } from "../../components/index.ts";
import { spanEs } from "../../lib/spanish.ts";
import { WORK_STATE_META } from "./meta.ts";

/** One task: state (glyph + word), title, project, who holds it and until when, its PR. */
export function BoardTaskRow({ task, project }: { task: BoardTaskView; project?: { slug: string; name: string } }) {
  const m = WORK_STATE_META[task.state];
  return (
    <li className={`bd-task tone-${m.tone}`} data-testid={`board-task-${task.id}`} data-state={task.state}>
      <Badge tone={m.tone} dot className="bd-task__state">{m.label}</Badge>
      <div className="bd-task__main">
        <span className="bd-task__title">{task.title}</span>
        <span className="wk-meta">
          {project && <a className="wk-project" href={`#/projects/${encodeURIComponent(project.slug)}`}>{project.name}</a>}
          {task.claimedBy && (
            <span>
              {task.claimedBy}
              {task.leaseUntil && (
                <>
                  {" · lease "}
                  <RelativeTime className="num" value={task.leaseUntil} format={spanEs} />
                </>
              )}
            </span>
          )}
          {task.pr && (
            <a href={prUrlOf(task.pr)} target="_blank" rel="noopener noreferrer" className="num">
              {task.pr}
            </a>
          )}
        </span>
      </div>
      <RelativeTime className="wk-when num" value={task.updatedAt} format={spanEs} />
    </li>
  );
}

export function BoardTaskList({ tasks, testId }: { tasks: { task: BoardTaskView; project?: { slug: string; name: string } }[]; testId?: string }) {
  return (
    <ul className="bd-tasks" data-testid={testId}>
      {tasks.map(({ task, project }) => <BoardTaskRow key={`${project?.slug ?? ""}:${task.id}`} task={task} project={project} />)}
    </ul>
  );
}
