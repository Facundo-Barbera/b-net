import { BOARD_CHANNEL_KINDS, boardChannel, projectHref, type BoardProjectView, type BoardTaskView } from "@b-net/core";
import {
  ActionLink,
  Badge,
  Callout,
  Card,
  DocIcon,
  DotIcon,
  EmptyState,
  PullRequestIcon,
  RelativeTime,
  StatusDot,
  Tag,
  useNow,
} from "../../components/index.ts";
import { BOARD_PROJECTS_URL, type BoardProjectsState } from "../../data/useBoardProjects.ts";
import { spanEs } from "../../lib/spanish.ts";
import {
  EVENT_KIND_META,
  PR_STATE_META,
  STATE_ORDER,
  WORK_STATE_META,
  countByState,
  isBoardEmpty,
  leaseText,
  newestFirst,
  prRefUrl,
  safeHref,
} from "./boardMeta.ts";

/**
 * Where the board data comes from, said once per view: example data (fixture mode, or the dev fallback while the
 * hub does not serve the board) or a stale copy after a failed refresh. Never role="alert": it is context, not an error.
 */
export function BoardNotice({ board, live }: { board: BoardProjectsState; live: boolean }) {
  if (board.origin === "fixture" && live) {
    return (
      <Callout tone="info" role="status" data-testid="board-fixture-notice">
        Tablero con datos de ejemplo (solo en desarrollo): el hub no entrega {BOARD_PROJECTS_URL} ({board.error}).
      </Callout>
    );
  }
  if (board.origin === "hub" && board.error) {
    return (
      <Callout tone="warn" role="status" data-testid="board-stale">
        Tablero: mostrando el último estado, falló la actualización ({board.error}).
      </Callout>
    );
  }
  return null;
}

/** Task counts on a project card, each with its glyph and word; only non-zero states. */
export function BoardCounts({ project }: { project: BoardProjectView | null }) {
  if (!project || project.tasks.length === 0) return null;
  const c = countByState(project);
  return (
    <span className="pj-counters pj-board-counts" data-testid={`board-counts-${project.slug}`}>
      <span className="ui-label">Tareas</span>
      {STATE_ORDER.filter((s) => c[s] > 0).map((s) => (
        <span key={s} className="pj-counter" data-state={s}>
          <StatusDot tone={WORK_STATE_META[s].tone} />
          <span className="num pj-counter__n">{c[s]}</span> {WORK_STATE_META[s].word(c[s])}
        </span>
      ))}
    </span>
  );
}

function TaskRow({ t }: { t: BoardTaskView }) {
  const now = useNow();
  const pr = t.pr ? prRefUrl(t.pr) : null;
  return (
    <li className="pj-task" data-state={t.state} data-testid={`task-${t.id}`}>
      <span className="pj-task__title">{t.title}</span>
      <span className="wk-meta">
        {t.claimedBy && <span>tomada por {t.claimedBy}</span>}
        {t.leaseUntil && <span className="num">{leaseText(t.leaseUntil, now, spanEs)}</span>}
        {t.pr && (pr ? <a className="num" href={pr} target="_blank" rel="noopener noreferrer">{t.pr}</a> : <span className="num">{t.pr}</span>)}
        {t.thread && <span>hilo <code>{t.thread}</code></span>}
        <RelativeTime className="num" value={t.updatedAt} format={spanEs} />
      </span>
    </li>
  );
}

/** Tasks in one lane per state. The lane head carries glyph + word + count, so a task's state reads without colour. */
function Lanes({ project }: { project: BoardProjectView }) {
  const c = countByState(project);
  return (
    <div className="pj-lanes" data-testid="board-tasks">
      {STATE_ORDER.map((s) => {
        const meta = WORK_STATE_META[s];
        const tasks = newestFirst(project.tasks.filter((t) => t.state === s), (t) => t.updatedAt);
        const headId = `pj-lane-${s}`;
        return (
          <section key={s} className="pj-lane" data-state={s} data-filled={tasks.length > 0 || undefined} aria-labelledby={headId} data-testid={`lane-${s}`}>
            <h3 id={headId} className="pj-lane__head">
              <StatusDot tone={meta.tone} pulse={s === "en_curso" && tasks.length > 0} />
              <span>{meta.plural}</span>
              <span className="wk-count num">{c[s]}</span>
            </h3>
            {tasks.length > 0 ? (
              <ul className="pj-lane__tasks">{tasks.map((t) => <TaskRow key={t.id} t={t} />)}</ul>
            ) : (
              <p className="pj-lane__none">Ninguna</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Updates({ project }: { project: BoardProjectView }) {
  const items = newestFirst(project.updates, (u) => u.at);
  return (
    <Card title="Avances" subtitle={items.length} flush data-testid="board-updates">
      {items.length > 0 ? (
        <ul className="pj-threads">
          {items.map((u) => {
            const href = safeHref(u.link);
            return (
              <li key={u.id} className="pj-thread">
                <DotIcon className="pj-thread__icon" />
                <div className="pj-thread__main">
                  <span className="pj-update__text">{u.text}</span>
                  <span className="wk-meta">
                    <span>{u.author}</span>
                    <RelativeTime className="num" value={u.at} format={spanEs} />
                  </span>
                </div>
                {href && <ActionLink href={href} external={!href.startsWith("#/")}>Ver</ActionLink>}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact className="pj-pad" title="Sin avances publicados." description={`Los bots los escriben en ${boardChannel(project.slug, "avances")}.`} />
      )}
    </Card>
  );
}

function Events({ project }: { project: BoardProjectView }) {
  const items = newestFirst(project.events, (e) => e.at);
  return (
    <Card title="Avisos de bots" subtitle={items.length} flush data-testid="board-events">
      {items.length > 0 ? (
        <ul className="pj-threads">
          {items.map((e, i) => {
            const meta = EVENT_KIND_META[e.kind];
            const href = safeHref(e.link);
            return (
              <li key={`${e.at}:${e.kind}:${i}`} className="pj-thread" data-kind={e.kind} data-testid={`event-${e.kind}`}>
                <Badge tone={meta.tone} dot>{meta.label}</Badge>
                <div className="pj-thread__main">
                  <span className="pj-update__text">{e.summary}</span>
                  <span className="wk-meta">
                    <span>para {e.bot}</span>
                    {e.thread && <span>hilo <code>{e.thread}</code></span>}
                    <RelativeTime className="num" value={e.at} format={spanEs} />
                  </span>
                </div>
                {href && <ActionLink href={href} external={!href.startsWith("#/")}>Abrir</ActionLink>}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact className="pj-pad" title="Sin avisos." description="Preguntas, bloqueos e hilos terminados que despiertan al bot del proyecto." />
      )}
    </Card>
  );
}

function Prs({ project }: { project: BoardProjectView }) {
  const items = newestFirst(project.prs, (p) => p.updatedAt);
  return (
    <Card title="PRs del tablero" subtitle={items.length} flush data-testid="board-prs">
      {items.length > 0 ? (
        <ul className="pj-threads">
          {items.map((p) => {
            const meta = PR_STATE_META[p.state];
            const href = safeHref(p.url);
            return (
              <li key={p.ref} className="pj-thread" data-pr-state={p.state}>
                <PullRequestIcon className="pj-thread__icon" />
                <div className="pj-thread__main">
                  <span className="pj-thread__title">{p.title}</span>
                  <span className="wk-meta">
                    <Badge tone={meta.tone} dot variant="outline">{meta.label}</Badge>
                    <span className="num">{p.ref}</span>
                    <RelativeTime className="num" value={p.updatedAt} format={spanEs} />
                  </span>
                </div>
                {href && <ActionLink href={href} external>Ver</ActionLink>}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact className="pj-pad" title="Sin PRs en el tablero." description={`Los bots los publican en ${boardChannel(project.slug, "prs")}.`} />
      )}
    </Card>
  );
}

/** HTML summaries are deliverables the hub already stores: the link opens them in this page's viewer. */
function Summaries({ project }: { project: BoardProjectView }) {
  const items = newestFirst(project.summaries, (s) => s.at);
  return (
    <Card title="Resúmenes HTML" subtitle={items.length} flush data-testid="board-summaries">
      {items.length > 0 ? (
        <ul className="pj-threads">
          {items.map((s) => (
            <li key={s.id} className="pj-thread">
              <DocIcon className="pj-thread__icon" />
              <div className="pj-thread__main">
                <span className="pj-thread__title">{s.title}</span>
                <span className="wk-meta"><RelativeTime className="num" value={s.at} format={spanEs} /></span>
              </div>
              <ActionLink href={projectHref(project.slug, s.id)} aria-label={`Abrir resumen: ${s.title}`}>Abrir</ActionLink>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact className="pj-pad" title="Sin resúmenes." description="Cuando un bot publica un entregable HTML, aparece aquí." />
      )}
    </Card>
  );
}

function Body({ board, slug }: { board: BoardProjectsState; slug: string | null }) {
  if (!slug) {
    return <EmptyState compact data-testid="board-unregistered" title="El tablero agrupa por proyecto registrado." description="Registra este proyecto en el hub para ver sus tareas, avances y avisos." />;
  }
  if (!board.data) {
    if (board.missing) {
      return (
        <EmptyState compact data-testid="board-missing" title="Tablero sin conectar." description={`El hub no tiene tablero (${BOARD_PROJECTS_URL}: ${board.error}). Cuando el motor de Board corra dentro del hub, las tareas aparecen aquí.`} />
      );
    }
    if (board.error) {
      return <EmptyState compact role="alert" data-testid="board-error" title="No se pudo leer el tablero." description={`${BOARD_PROJECTS_URL}: ${board.error}`} />;
    }
    return <EmptyState compact role="status" title="Cargando tablero…" />;
  }
  const project = board.data.projects.find((p) => p.slug === slug);
  if (!project || isBoardEmpty(project)) {
    return (
      <EmptyState
        compact
        data-testid="board-empty"
        title="Este proyecto todavía no tiene nada en el tablero."
        description={`Los bots publican en ${BOARD_CHANNEL_KINDS.map((k) => boardChannel(slug, k)).join(", ")}.`}
      />
    );
  }
  return (
    <>
      <Lanes project={project} />
      <div className="pj-board__grid">
        <Events project={project} />
        <Updates project={project} />
        <Prs project={project} />
        <Summaries project={project} />
      </div>
    </>
  );
}

/** The project's board: tasks by state, then bot notices, updates, PRs and HTML summaries. */
export function BoardPanel({ board, slug, live }: { board: BoardProjectsState; slug: string | null; live: boolean }) {
  const bot = board.data?.projects.find((p) => p.slug === slug)?.bot;
  return (
    <section className="wk-section pj-board" aria-labelledby="pj-board" data-testid="project-board">
      <header className="wk-section__head">
        <h2 id="pj-board" className="wk-section__title">
          Tablero {bot && <Tag>bot {bot}</Tag>}
        </h2>
        <p className="wk-section__hint">Lo que los bots publican en el tablero del hub: tareas, avisos, avances, PRs y resúmenes.</p>
      </header>
      <BoardNotice board={board} live={live} />
      <Body board={board} slug={slug} />
    </section>
  );
}
