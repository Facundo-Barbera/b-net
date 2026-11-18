import type { WorkItem } from "@b-net/core";
import { ActionLink, Badge, RelativeTime, StatusDot, useNow } from "../../components/index.ts";
import { formatDuration } from "../../lib/format.ts";
import { spanEs } from "../../lib/spanish.ts";
import { KIND_META, LINK_LABEL, isExternal, linkAria } from "./kinds.ts";

function Action({ item }: { item: WorkItem }) {
  if (!item.link) return null;
  const { Icon } = KIND_META[item.kind];
  return (
    <ActionLink href={item.link.href} external={isExternal(item.link)} icon={<Icon />} aria-label={linkAria(item)}>
      {LINK_LABEL[item.link.kind]}
    </ActionLink>
  );
}

/** Kind word with its tone glyph (shape + colour + text). */
export function KindBadge({ item }: { item: WorkItem }) {
  const m = KIND_META[item.kind];
  return (
    <Badge tone={m.tone} dot className="wk-kind" data-kind={item.kind}>
      {m.label}
    </Badge>
  );
}

/**
 * "Te espera" queue row: rank, kind (glyph + word), what, where, since when, and the one action that resolves it.
 * A row rather than a card so a long queue stays scannable top to bottom, most urgent first.
 */
export function WaitingCard({ item, machine, rank }: { item: WorkItem; machine: string | null; rank: number }) {
  const m = KIND_META[item.kind];
  return (
    <article className={`wk-wait tone-${m.tone}`} data-testid={`wait-${item.id}`} data-kind={item.kind} aria-label={`${rank}. ${m.label}: ${item.title}`}>
      <span className="wk-wait__rank num" aria-hidden="true">{rank}</span>
      <div className="wk-wait__main">
        <div className="wk-wait__head">
          <KindBadge item={item} />
          <RelativeTime className="wk-when num" value={item.at} format={spanEs} />
        </div>
        <h3 className="wk-wait__title">{item.title}</h3>
        <p className="wk-meta">
          <a className="wk-project" href={`#/projects/${encodeURIComponent(item.project.key)}`}>{item.project.name}</a>
          {machine && <span className="num">{machine}</span>}
          {item.detail && <span className="wk-meta__detail">{item.detail}</span>}
        </p>
      </div>
      <div className="wk-wait__act">
        <Action item={item} />
      </div>
    </article>
  );
}

/** Running thread row: elapsed run time is the headline number. */
export function RunningRow({ item, machine }: { item: WorkItem; machine: string | null }) {
  const now = useNow();
  const since = item.since ?? item.at;
  const elapsed = Math.max(0, (now - Date.parse(since)) / 1000);
  return (
    <li className="wk-row wk-row--running" data-testid={`run-${item.id}`}>
      <StatusDot tone="ok" pulse label="Corriendo" />
      <div className="wk-row__main">
        <span className="wk-row__title">{item.title}</span>
        <span className="wk-meta">
          {machine && <span className="num">{machine}</span>}
          {item.detail && <span className="wk-meta__detail">{item.detail}</span>}
        </span>
      </div>
      <span className="wk-elapsed num" title={`Corriendo desde ${since}`}>
        <span className="sr-only">corriendo hace </span>
        {formatDuration(elapsed)}
      </span>
      <Action item={item} />
    </li>
  );
}

/** Generic event row ("Listo hace poco", project activity). */
export function EventRow({ item, machine, showProject = true }: { item: WorkItem; machine: string | null; showProject?: boolean }) {
  return (
    <li className="wk-row" data-testid={`event-${item.id}`} data-kind={item.kind}>
      <KindBadge item={item} />
      <div className="wk-row__main">
        <span className="wk-row__title">{item.title}</span>
        <span className="wk-meta">
          {showProject && <a className="wk-project" href={`#/projects/${encodeURIComponent(item.project.key)}`}>{item.project.name}</a>}
          {machine && <span className="num">{machine}</span>}
          {item.detail && <span className="wk-meta__detail">{item.detail}</span>}
        </span>
      </div>
      <RelativeTime className="wk-when num" value={item.at} format={spanEs} />
      <Action item={item} />
    </li>
  );
}

/**
 * "Listo hace poco" as a timeline: the kind glyph sits on the rail (shape per kind), the word says what
 * happened, then title, project and time. Newest first, as the hub sends it.
 */
export function TimelineItem({ item, machine }: { item: WorkItem; machine: string | null }) {
  const m = KIND_META[item.kind];
  return (
    <li className={`wk-tl__item tone-${m.tone}`} data-testid={`event-${item.id}`} data-kind={item.kind}>
      <span className="wk-tl__node" aria-hidden="true">
        <StatusDot tone={m.tone} />
      </span>
      <div className="wk-tl__body">
        <div className="wk-tl__head">
          <span className="wk-tl__kind">{m.label}</span>
          <RelativeTime className="wk-when num" value={item.at} format={spanEs} />
        </div>
        <span className="wk-tl__title">{item.title}</span>
        <span className="wk-meta">
          <a className="wk-project" href={`#/projects/${encodeURIComponent(item.project.key)}`}>{item.project.name}</a>
          {machine && <span className="num">{machine}</span>}
          {item.detail && <span className="wk-meta__detail">{item.detail}</span>}
        </span>
        <div className="wk-tl__act">
          <Action item={item} />
        </div>
      </div>
    </li>
  );
}
