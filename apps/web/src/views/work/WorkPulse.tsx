import type { ReactNode } from "react";
import { WORK_RECENT_HOURS, type HubSnapshot, type WorkSnapshot } from "@fhub/core";
import { ArrowRightIcon, RelativeTime, StatusDot, useNow, type Tone } from "../../components/index.ts";
import { formatDuration } from "../../lib/format.ts";
import { spanEs } from "../../lib/spanish.ts";
import { summarize } from "../machines/derive.ts";

/** Scroll to a work section; instant when the user asked for reduced motion. */
function jumpTo(id: string) {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

interface TileProps {
  id: string;
  label: string;
  value: ReactNode;
  hint: ReactNode;
  tone: Tone;
  pulse?: boolean;
  /** In-page section id (button) or a route (link). */
  target: { section: string } | { href: string };
}

/** Status glyph + word + big number + one line of context. The word and the shape carry the state, not the colour. */
function Tile({ id, label, value, hint, tone, pulse, target }: TileProps) {
  const body = (
    <>
      <span className="wk-tile__top">
        <StatusDot tone={tone} pulse={pulse} />
        <span className="wk-tile__label">{label}</span>
        <ArrowRightIcon className="wk-tile__go" />
      </span>
      <span className="wk-tile__value num">{value}</span>
      <span className="wk-tile__hint">{hint}</span>
    </>
  );
  const cls = `wk-tile tone-${tone}`;
  return "href" in target ? (
    <a className={cls} data-testid={`pulse-${id}`} data-tone={tone} href={target.href}>{body}</a>
  ) : (
    <button className={cls} data-testid={`pulse-${id}`} data-tone={tone} type="button" onClick={() => jumpTo(target.section)}>{body}</button>
  );
}

/**
 * The first thing on the home: four tiles that answer "what needs me, what is moving, what landed, is the
 * fleet fine" before any list. Work tiles jump to their section; the fleet tile opens Máquinas.
 */
export function WorkPulse({ work, snapshot }: { work: WorkSnapshot; snapshot: HubSnapshot }) {
  const now = useNow();
  const oldest = work.waiting.reduce<string | null>((min, i) => (min === null || i.at < min ? i.at : min), null);
  const longest = work.running[0];
  const longestSec = longest ? Math.max(0, (now - Date.parse(longest.since ?? longest.at)) / 1000) : null;
  const fleet = summarize(snapshot.machines, snapshot.hubMachineId);
  const fleetTone: Tone = fleet.offline > 0 ? "danger" : fleet.degraded > 0 ? "warn" : fleet.total > 0 ? "ok" : "dormant";
  const fleetHint = [fleet.offline ? `${fleet.offline} offline` : null, fleet.degraded ? `${fleet.degraded} degraded` : null].filter(Boolean).join(" · ") || (fleet.total ? "todas alcanzables" : "sin máquinas");

  return (
    <div className="wk-pulse" role="group" aria-label="Resumen de trabajo" data-testid="work-pulse">
      <Tile
        id="waiting"
        label="Te espera"
        value={work.waiting.length}
        tone={work.waiting.length ? "warn" : "ok"}
        hint={oldest ? <>lo más antiguo <RelativeTime value={oldest} format={spanEs} /></> : "todo al día"}
        target={{ section: "wk-waiting" }}
      />
      <Tile
        id="running"
        label="En curso"
        value={work.running.length}
        tone={work.running.length ? "ok" : "dormant"}
        pulse={work.running.length > 0}
        hint={longestSec !== null ? <>el más largo <span className="num">{formatDuration(longestSec)}</span></> : "nada corriendo"}
        target={{ section: "wk-running" }}
      />
      <Tile
        id="done"
        label="Listo"
        value={work.done.length}
        tone="info"
        hint={`últimas ${WORK_RECENT_HOURS} h`}
        target={{ section: "wk-done" }}
      />
      <Tile
        id="fleet"
        label="Flota"
        value={<>{fleet.online}<small>/{fleet.total}</small></>}
        tone={fleetTone}
        hint={fleetHint}
        target={{ href: "#/machines" }}
      />
    </div>
  );
}
