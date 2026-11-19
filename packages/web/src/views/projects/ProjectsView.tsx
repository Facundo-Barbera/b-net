import { HubRoutes, NO_PROJECT_KEY, projectHref, type ProjectWork, type WorkSnapshot } from "@b-net/core";
import { useState } from "react";
import { ArrowRightIcon, Callout, EmptyState, PageHeader, RelativeTime, SearchField, Segmented } from "../../components/index.ts";
import { spanEs } from "../../lib/spanish.ts";
import { matchesWords } from "../../lib/text.ts";
import type { ViewProps } from "../../routes.tsx";
import { useHashSegments } from "../../shell/useHashPath.ts";
import { WorkSourceGap } from "../shared/WorkSourceGap.tsx";
import "../work/work.css";
import "./projects.css";
import { Counters } from "./Counters.tsx";
import { ProjectDetail } from "./ProjectDetail.tsx";

type Filter = "all" | "active";

/** A project with something that needs Facundo or is running now. */
const isActive = (p: ProjectWork) => p.counts.waiting + p.counts.running > 0;

/** Search over name and description, accent-insensitive. */
const matches = (p: ProjectWork, q: string) => matchesWords(`${p.ref.name} ${p.description}`, q);

/**
 * Project card: the whole card is one link. A project waiting on Facundo gets the warn edge, and its counter
 * keeps the triangle glyph and the words "en espera", so the state never rests on the edge colour.
 */
function ProjectCard({ p }: { p: ProjectWork }) {
  const attention = p.counts.waiting > 0 ? "waiting" : p.counts.running > 0 ? "running" : undefined;
  return (
    <li>
      <a className="pj-card" href={projectHref(p.ref.key)} data-testid={`project-${p.ref.key}`} data-attention={attention}>
        <span className="pj-card__head">
          <span className="pj-card__name">{p.ref.name}</span>
          <ArrowRightIcon className="pj-card__go" />
        </span>
        {p.description ? <span className="pj-card__desc">{p.description}</span> : <span className="pj-card__desc u-faint">Sin descripción</span>}
        <Counters p={p} />
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

function Cards({ items }: { items: readonly ProjectWork[] }) {
  return <ul className="pj-cards">{items.map((p) => <ProjectCard key={p.ref.key} p={p} />)}</ul>;
}

const NoMatch = () => <EmptyState compact title="Ningún proyecto coincide con el filtro." />;

function ProjectList({ work, query, filter }: { work: WorkSnapshot; query: string; filter: Filter }) {
  const keep = (p: ProjectWork) => (filter === "all" || isActive(p)) && matches(p, query);
  const filtering = filter !== "all" || query.trim() !== "";
  const allRegistered = work.projects.filter((p) => p.registered);
  const allInferred = work.projects.filter((p) => !p.registered && p.ref.key !== NO_PROJECT_KEY);
  const registered = allRegistered.filter(keep);
  const inferred = allInferred.filter(keep);
  const none = work.projects.find((p) => p.ref.key === NO_PROJECT_KEY && keep(p));
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
          <Cards items={registered} />
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
          <Cards items={inferred} />
        ) : work.sources.threads !== "ok" ? (
          <WorkSourceGap kind="threads" state={work.sources.threads} />
        ) : filtering && allInferred.length > 0 ? (
          <NoMatch />
        ) : (
          <EmptyState compact title="Todos los hilos de T3 tienen proyecto registrado." />
        )}
        {none && <Cards items={[none]} />}
      </section>
    </>
  );
}

/** "#/projects" lists projects with counters; "#/projects/<key>[/d/<deliverable>]" shows one project. */
export function ProjectsView({ snapshot, work }: ViewProps) {
  const [key, sub, deliverableId] = useHashSegments();
  // Filters live in the view, not the URL: the hash already carries the route and project key.
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const data = work.data;
  const project = key ? data?.projects.find((p) => p.ref.key === key) : undefined;

  if (key && data) {
    return project ? (
      <ProjectDetail project={project} work={data} mode={work.mode} machines={snapshot.machines} selectedDeliverableId={sub === "d" ? (deliverableId ?? null) : null} />
    ) : (
      <section className="ui-view pj" data-testid="view-projects" aria-labelledby="pj-title">
        <PageHeader title="Proyecto no encontrado" titleId="pj-title" />
        <EmptyState data-testid="project-missing" title={`No hay ningún proyecto «${key}».`} action={<a className="ui-action" href="#/projects">Volver a Proyectos</a>} />
      </section>
    );
  }

  const active = data ? data.projects.filter(isActive).length : 0;
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
      {data ? (
        <ProjectList work={data} query={query} filter={filter} />
      ) : work.error ? (
        <EmptyState role="alert" title="El hub no entrega la vista de trabajo" description={`${HubRoutes.work}: ${work.error}`} />
      ) : (
        <EmptyState role="status" title="Cargando proyectos…" />
      )}
    </section>
  );
}
