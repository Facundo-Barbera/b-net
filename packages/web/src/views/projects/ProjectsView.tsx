import { HubRoutes, NO_PROJECT_KEY, projectHref, type ProjectWork, type WorkSnapshot } from "@b-net/core";
import { Callout, EmptyState, PageHeader, RelativeTime } from "../../components/index.ts";
import { spanEs } from "../../lib/spanish.ts";
import type { ViewProps } from "../../routes.tsx";
import { useHashSegments } from "../../shell/useHashPath.ts";
import { WorkSourceGap } from "../shared/WorkSourceGap.tsx";
import "../work/work.css";
import "./projects.css";
import { Counters } from "./Counters.tsx";
import { ProjectDetail } from "./ProjectDetail.tsx";

function ProjectRow({ p }: { p: ProjectWork }) {
  return (
    <li>
      <a className="pj-row" href={projectHref(p.ref.key)} data-testid={`project-${p.ref.key}`}>
        <span className="pj-row__main">
          <span className="pj-row__name">{p.ref.name}</span>
          {p.description && <span className="pj-row__desc">{p.description}</span>}
        </span>
        <Counters p={p} />
        <span className="pj-row__when">
          {p.lastActivityAt ? <RelativeTime className="num" value={p.lastActivityAt} format={spanEs} /> : <span className="u-faint">sin actividad</span>}
        </span>
      </a>
    </li>
  );
}

function ProjectList({ work }: { work: WorkSnapshot }) {
  const registered = work.projects.filter((p) => p.registered);
  const inferred = work.projects.filter((p) => !p.registered && p.ref.key !== NO_PROJECT_KEY);
  const none = work.projects.find((p) => p.ref.key === NO_PROJECT_KEY);
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
        ) : registered.length === 0 ? (
          <EmptyState compact title="Aún no hay proyectos registrados." description="Un bot los crea con POST /api/v1/projects; grouping.t3ProjectTitles une sus hilos de T3." />
        ) : (
          <ul className="pj-list">{registered.map((p) => <ProjectRow key={p.ref.key} p={p} />)}</ul>
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
          <ul className="pj-list">{inferred.map((p) => <ProjectRow key={p.ref.key} p={p} />)}</ul>
        ) : work.sources.threads !== "ok" ? (
          <WorkSourceGap kind="threads" state={work.sources.threads} />
        ) : (
          <EmptyState compact title="Todos los hilos de T3 tienen proyecto registrado." />
        )}
        {none && (
          <ul className="pj-list">
            <ProjectRow p={none} />
          </ul>
        )}
      </section>
    </>
  );
}

/** "#/projects" lists projects with counters; "#/projects/<key>[/d/<deliverable>]" shows one project. */
export function ProjectsView({ snapshot, work }: ViewProps) {
  const [key, sub, deliverableId] = useHashSegments();
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

  return (
    <section className="ui-view pj" data-testid="view-projects" aria-labelledby="pj-title">
      <PageHeader
        title="Proyectos"
        titleId="pj-title"
        subtitle={data ? <span className="num">{data.projects.length} proyectos · {data.threads.length} hilos · {data.prs.length} PRs enlazados</span> : null}
      />
      {data && work.error && <Callout tone="warn" role="alert">Mostrando el último estado: falló la actualización ({work.error})</Callout>}
      {data ? (
        <ProjectList work={data} />
      ) : work.error ? (
        <EmptyState role="alert" title="El hub no entrega la vista de trabajo" description={`${HubRoutes.work}: ${work.error}`} />
      ) : (
        <EmptyState role="status" title="Cargando proyectos…" />
      )}
    </section>
  );
}
