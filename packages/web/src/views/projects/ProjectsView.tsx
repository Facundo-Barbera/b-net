import { HubRoutes, NO_PROJECT_KEY, projectHref, type BoardProjectView, type BoardProjectsResponse, type ProjectWork, type WorkSnapshot } from "@b-net/core";
import { useState } from "react";
import { ArrowLeftIcon, ArrowRightIcon, Badge, Callout, EmptyState, PageHeader, RelativeTime, SearchField, Segmented } from "../../components/index.ts";
import { useBoardProjects, type BoardProjectsState } from "../../data/useBoardProjects.ts";
import { spanEs } from "../../lib/spanish.ts";
import { matchesWords } from "../../lib/text.ts";
import type { ViewProps } from "../../routes.tsx";
import { useHashSegments } from "../../shell/useHashPath.ts";
import { WorkSourceGap } from "../shared/WorkSourceGap.tsx";
import "../work/work.css";
import "./projects.css";
import { BoardCounts, BoardNotice, BoardPanel } from "./BoardPanel.tsx";
import { boardActivity, findBoardProject } from "./boardMeta.ts";
import { Counters } from "./Counters.tsx";
import { ProjectDetail } from "./ProjectDetail.tsx";

type Filter = "all" | "active";

/** A project with something that needs Facundo or is running now, in T3 or on the board. */
function isActive(p: ProjectWork, board: BoardProjectsResponse | null) {
  const b = boardActivity(findBoardProject(board, p.ref.projectId));
  return p.counts.waiting + p.counts.running + b.blocked + b.running > 0;
}

/** Search over name and description, accent-insensitive. */
const matches = (p: ProjectWork, q: string) => matchesWords(`${p.ref.name} ${p.description}`, q);

/**
 * Project card: the whole card is one link. A project waiting on Facundo gets the warn edge, one with a blocked
 * board task the danger edge; the counters repeat it with a glyph and words, so the state never rests on the edge colour.
 */
function ProjectCard({ p, board }: { p: ProjectWork; board: BoardProjectView | null }) {
  const b = boardActivity(board);
  const attention = p.counts.waiting > 0 ? "waiting" : b.blocked > 0 ? "blocked" : p.counts.running + b.running > 0 ? "running" : undefined;
  return (
    <li>
      <a className="pj-card" href={projectHref(p.ref.key)} data-testid={`project-${p.ref.key}`} data-attention={attention}>
        <span className="pj-card__head">
          <span className="pj-card__name">{p.ref.name}</span>
          <ArrowRightIcon className="pj-card__go" />
        </span>
        {p.description ? <span className="pj-card__desc">{p.description}</span> : <span className="pj-card__desc u-faint">Sin descripción</span>}
        <Counters p={p} />
        <BoardCounts project={board} />
        <span className="pj-card__when">
          {p.lastActivityAt ? (
            <>
              actividad <RelativeTime className="num" value={p.lastActivityAt} format={spanEs} />
            </>
          ) : (
            "sin actividad"
          )}
        </span>
      </a>
    </li>
  );
}

function Cards({ items, board }: { items: readonly ProjectWork[]; board: BoardProjectsResponse | null }) {
  return <ul className="pj-cards">{items.map((p) => <ProjectCard key={p.ref.key} p={p} board={findBoardProject(board, p.ref.projectId)} />)}</ul>;
}

/** Board projects whose slug no hub project has: still reachable, so nothing a bot publishes is invisible. */
function BoardOnlyCards({ items }: { items: readonly BoardProjectView[] }) {
  return (
    <ul className="pj-cards">
      {items.map((b) => (
        <li key={b.slug}>
          <a className="pj-card" href={projectHref(b.slug)} data-testid={`board-only-${b.slug}`} data-attention={boardActivity(b).blocked > 0 ? "blocked" : undefined}>
            <span className="pj-card__head">
              <span className="pj-card__name">{b.name}</span>
              <ArrowRightIcon className="pj-card__go" />
            </span>
            <span className="pj-card__desc u-faint">Solo en el tablero{b.bot ? ` · bot ${b.bot}` : ""}</span>
            <BoardCounts project={b} />
          </a>
        </li>
      ))}
    </ul>
  );
}

const NoMatch = () => <EmptyState compact title="Ningún proyecto coincide con el filtro." />;

function ProjectList({ work, board, query, filter }: { work: WorkSnapshot; board: BoardProjectsResponse | null; query: string; filter: Filter }) {
  const keep = (p: ProjectWork) => (filter === "all" || isActive(p, board)) && matches(p, query);
  const filtering = filter !== "all" || query.trim() !== "";
  const allRegistered = work.projects.filter((p) => p.registered);
  const allInferred = work.projects.filter((p) => !p.registered && p.ref.key !== NO_PROJECT_KEY);
  const registered = allRegistered.filter(keep);
  const inferred = allInferred.filter(keep);
  const none = work.projects.find((p) => p.ref.key === NO_PROJECT_KEY && keep(p));
  const known = new Set(work.projects.map((p) => p.ref.projectId).filter(Boolean));
  const boardOnly = (board?.projects ?? []).filter(
    (b) => !known.has(b.slug) && (filter === "all" || boardActivity(b).blocked + boardActivity(b).running > 0) && matchesWords(b.name, query),
  );
  return (
    <>
      <section className="wk-section" aria-labelledby="pj-registered" data-testid="projects-registered">
        <header className="wk-section__head">
          <h2 id="pj-registered" className="wk-section__title">
            Registrados <span className="wk-count num">{registered.length}</span>
          </h2>
          <p className="wk-section__hint">Proyectos del hub: reciben entregables de los bots y agrupan hilos por título de T3.</p>
        </header>
        {work.sources.projects !== "ok" ? (
          <WorkSourceGap kind="projects" state={work.sources.projects} />
        ) : allRegistered.length === 0 ? (
          <EmptyState compact title="Aún no hay proyectos registrados." description="Un bot los crea con POST /api/v1/projects; grouping.t3ProjectTitles une sus hilos de T3." />
        ) : registered.length === 0 ? (
          <NoMatch />
        ) : (
          <Cards items={registered} board={board} />
        )}
      </section>

      <section className="wk-section" aria-labelledby="pj-inferred" data-testid="projects-inferred">
        <header className="wk-section__head">
          <h2 id="pj-inferred" className="wk-section__title">
            Desde T3, sin registrar <span className="wk-count num">{inferred.length}</span>
          </h2>
          <p className="wk-section__hint">Títulos de proyecto de T3 que ningún proyecto del hub reclama. Regístralos para recibir entregables.</p>
        </header>
        {inferred.length > 0 ? (
          <Cards items={inferred} board={board} />
        ) : work.sources.threads !== "ok" ? (
          <WorkSourceGap kind="threads" state={work.sources.threads} />
        ) : filtering && allInferred.length > 0 ? (
          <NoMatch />
        ) : (
          <EmptyState compact title="Todos los hilos de T3 tienen proyecto registrado." />
        )}
        {none && <Cards items={[none]} board={board} />}
      </section>

      {boardOnly.length > 0 && (
        <section className="wk-section" aria-labelledby="pj-board-only" data-testid="projects-board-only">
          <header className="wk-section__head">
            <h2 id="pj-board-only" className="wk-section__title">
              Solo en el tablero <span className="wk-count num">{boardOnly.length}</span>
            </h2>
            <p className="wk-section__hint">Canales del tablero cuyo proyecto no está registrado en el hub.</p>
          </header>
          <BoardOnlyCards items={boardOnly} />
        </section>
      )}
    </>
  );
}

/** A board project the hub does not know: its board, and how to register it to get deliverables and threads. */
function BoardOnlyDetail({ project, board, live }: { project: BoardProjectView; board: BoardProjectsState; live: boolean }) {
  return (
    <section className="ui-view pj pj-detail" data-testid="view-projects" aria-labelledby="pj-title">
      <a className="pj-back" href="#/projects">
        <ArrowLeftIcon /> Proyectos
      </a>
      <header className="pj-hero">
        <div className="pj-hero__title">
          <h1 id="pj-title">{project.name}</h1>
          <Badge variant="outline">solo en el tablero</Badge>
        </div>
        <p className="pj-hero__desc">Regístralo en el hub (POST /api/v1/projects con el slug «{project.slug}») para sumar sus hilos de T3 y entregables.</p>
      </header>
      <BoardPanel board={board} slug={project.slug} live={live} />
    </section>
  );
}

/** "#/projects" lists projects with counters; "#/projects/<key>[/d/<deliverable>]" shows one project. */
export function ProjectsView({ snapshot, work }: ViewProps) {
  const [key, sub, deliverableId] = useHashSegments();
  // Read here, not in the shell: only Proyectos polls the board, and only while it is open.
  const board = useBoardProjects(work.mode);
  const live = work.mode === "live";
  // Filters live in the view, not the URL: the hash already carries the route and project key.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const data = work.data;
  const project = key ? data?.projects.find((p) => p.ref.key === key) : undefined;
  const boardOnly = key && !project ? findBoardProject(board.data, key) : null;

  if (key && data) {
    return project ? (
      <ProjectDetail
        project={project}
        work={data}
        board={board}
        mode={work.mode}
        machines={snapshot.machines}
        selectedDeliverableId={sub === "d" ? (deliverableId ?? null) : null}
      />
    ) : boardOnly ? (
      <BoardOnlyDetail project={boardOnly} board={board} live={live} />
    ) : (
      <section className="ui-view pj" data-testid="view-projects" aria-labelledby="pj-title">
        <PageHeader title="Proyecto no encontrado" titleId="pj-title" />
        <EmptyState data-testid="project-missing" title={`No hay ningún proyecto «${key}».`} action={<a className="ui-action" href="#/projects">Volver a Proyectos</a>} />
      </section>
    );
  }

  const active = data ? data.projects.filter((p) => isActive(p, board.data)).length : 0;
  const controls = data ? (
    <>
      <SearchField label="Buscar proyectos" placeholder="Buscar proyectos…" value={query} onChange={setQuery} className="pj-search" data-testid="projects-search" />
      <Segmented<Filter>
        label="Filtrar proyectos"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "Todos", count: data.projects.length },
          { value: "active", label: "Con actividad", count: active },
        ]}
      />
    </>
  ) : null;

  return (
    <section className="ui-view pj" data-testid="view-projects" aria-labelledby="pj-title">
      <PageHeader
        eyebrow="Trabajo"
        title="Proyectos"
        titleId="pj-title"
        subtitle={data ? <span className="num">{data.projects.length} proyectos · {data.threads.length} hilos · {data.prs.length} PRs enlazados</span> : null}
        actions={controls}
      />
      {data && work.error && <Callout tone="warn" role="alert">Mostrando el último estado: falló la actualización ({work.error})</Callout>}
      {data && <BoardNotice board={board} live={live} />}
      {data ? (
        <ProjectList work={data} board={board.data} query={query} filter={filter} />
      ) : work.error ? (
        <EmptyState role="alert" title="El hub no entrega la vista de trabajo" description={`${HubRoutes.work}: ${work.error}`} />
      ) : (
        <EmptyState role="status" title="Cargando proyectos…" />
      )}
    </section>
  );
}
