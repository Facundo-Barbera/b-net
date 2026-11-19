import { projectHref, type Deliverable } from "@fhub/core";
import { ActionLink, Card, DownloadIcon, EmptyState, RelativeTime, Tag } from "../../components/index.ts";
import { deliverableContentUrl, useDeliverables } from "../../data/useDeliverables.ts";
import type { DataMode } from "../../data/useSnapshot.ts";
import { formatBytes } from "../../lib/format.ts";
import { spanEs } from "../../lib/spanish.ts";

/**
 * The published file, embedded. HTML/Markdown/text/SVG go in an iframe with an empty `sandbox` (no scripts,
 * opaque origin), matching the hub's CSP sandbox for that content. PDF cannot render sandboxed, so it only
 * relies on the hub's CSP (frame-ancestors 'self'). Images and video use native elements.
 */
function Preview({ d, mode }: { d: Deliverable; mode: DataMode }) {
  if (mode === "fixture") {
    return (
      <EmptyState
        compact
        className="pj-viewer__empty"
        data-testid="viewer-fixture"
        title="Vista previa no disponible con datos de ejemplo."
        description="El contenido lo sirve el hub; con datos en vivo aquí se ve el entregable publicado."
      />
    );
  }
  const src = deliverableContentUrl(d);
  switch (d.kind) {
    case "png":
    case "jpeg":
    case "webp":
      return <img className="pj-viewer__media" src={src} alt={d.title} />;
    case "mp4":
    case "webm":
      return <video className="pj-viewer__media" src={src} controls preload="metadata" aria-label={d.title} />;
    case "pdf":
      return <iframe className="pj-viewer__frame" src={src} title={`Entregable: ${d.title}`} referrerPolicy="no-referrer" data-testid="viewer-frame" />;
    default:
      return <iframe className="pj-viewer__frame" src={src} title={`Entregable: ${d.title}`} sandbox="" referrerPolicy="no-referrer" data-testid="viewer-frame" />;
  }
}

export function DeliverablesPanel({
  projectId,
  mode,
  version,
  selectedId,
}: {
  projectId: string;
  mode: DataMode;
  /** Changes when the project gets a new deliverable (refetch trigger). */
  version: string;
  selectedId: string | null;
}) {
  const { data, error } = useDeliverables(projectId, mode, version);
  const list = data ?? [];
  const selected = list.find((d) => d.id === selectedId) ?? list[0] ?? null;

  return (
    <Card title="Entregables" subtitle={data ? list.length : undefined} flush className="pj-deliverables" data-testid="deliverables">
      {error && !data ? (
        <EmptyState role="alert" compact className="pj-pad" title="No se pudieron cargar los entregables." description={error} />
      ) : !data ? (
        <EmptyState role="status" compact className="pj-pad" title="Cargando entregables…" />
      ) : list.length === 0 ? (
        <EmptyState
          compact
          className="pj-pad"
          data-testid="deliverables-empty"
          title="Este proyecto todavía no tiene entregables."
          description="Cuando un bot publique un resumen (POST …/deliverables), aparece aquí y en Trabajo."
        />
      ) : (
        <div className="pj-deliv">
          <ul className="pj-deliv__list" aria-label="Lista de entregables">
            {list.map((d) => (
              <li key={d.id}>
                <a
                  className="pj-deliv__item"
                  href={projectHref(projectId, d.id)}
                  aria-current={selected?.id === d.id ? "true" : undefined}
                  data-testid={`deliverable-${d.id}`}
                >
                  <span className="pj-deliv__title">{d.title}</span>
                  <span className="wk-meta">
                    <Tag>{d.kind}</Tag>
                    <span>{d.author}</span>
                    <RelativeTime className="num" value={d.createdAt} format={spanEs} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {selected && (
            <figure className="pj-viewer" data-testid="viewer" aria-label={`Vista previa: ${selected.title}`}>
              <figcaption className="pj-viewer__bar">
                <span className="pj-viewer__title">{selected.title}</span>
                <span className="wk-meta">
                  <span className="num">{formatBytes(selected.sizeBytes)}</span>
                  <span>{selected.filename}</span>
                </span>
                <span className="pj-viewer__actions">
                  <ActionLink href={deliverableContentUrl(selected)} external>Abrir</ActionLink>
                  <ActionLink href={deliverableContentUrl(selected, true)} icon={<DownloadIcon />} download={selected.filename}>Descargar</ActionLink>
                </span>
              </figcaption>
              <Preview d={selected} mode={mode} />
            </figure>
          )}
        </div>
      )}
    </Card>
  );
}
