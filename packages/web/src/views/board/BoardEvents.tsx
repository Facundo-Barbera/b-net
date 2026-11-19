import type { BnetEventV1 } from "@b-net/core";
import { ActionLink, RelativeTime, StatusDot } from "../../components/index.ts";
import { spanEs } from "../../lib/spanish.ts";
import { EVENT_KIND_META } from "./meta.ts";

const isExternal = (href: string) => /^https?:/.test(href);

/** Bot notices (bnet.event@1) as a timeline: kind glyph on the rail + kind word, summary, project, bot, link. */
export function BoardEvents({ events, showProject = true, testId }: { events: { event: BnetEventV1; name?: string }[]; showProject?: boolean; testId?: string }) {
  return (
    <ol className="wk-tl" data-testid={testId}>
      {events.map(({ event, name }, i) => {
        const m = EVENT_KIND_META[event.kind];
        return (
          <li key={`${event.project}:${event.at}:${i}`} className={`wk-tl__item tone-${m.tone}`} data-kind={event.kind}>
            <span className="wk-tl__node" aria-hidden="true">
              <StatusDot tone={m.tone} />
            </span>
            <div className="wk-tl__body">
              <div className="wk-tl__head">
                <span className="wk-tl__kind">{m.label}</span>
                <RelativeTime className="wk-when num" value={event.at} format={spanEs} />
              </div>
              <span className="wk-tl__title">{event.summary}</span>
              <span className="wk-meta">
                {showProject && <a className="wk-project" href={`#/projects/${encodeURIComponent(event.project)}`}>{name ?? event.project}</a>}
                <span>para {event.bot}</span>
                {event.thread && <span className="num">{event.thread}</span>}
              </span>
              {event.link && (
                <div className="wk-tl__act">
                  <ActionLink href={event.link} external={isExternal(event.link)} aria-label={`Abrir: ${event.summary}`}>
                    Abrir
                  </ActionLink>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
