import type { SourceHealth } from "@b-net/core";
import { RelativeTime } from "../components/RelativeTime.tsx";
import { StatusDot } from "../components/StatusDot.tsx";
import { CORE_SOURCES, SOURCE_SETUP } from "../data/sources.ts";
import { spanEs } from "../lib/spanish.ts";

export function sourceLabel(s: Pick<SourceHealth, "source" | "machineId">): string {
  return s.machineId ? `${s.source} · ${s.machineId}` : s.source;
}

/**
 * Sidebar block: one row per hub data source, failing first, then connected, then the core sources
 * the hub does not have configured ("sin conectar"), so a missing Beszel or proxy is visible here and
 * not only as empty numbers in the views. Each row: status glyph (shape per state) + name + a word or time.
 */
export function SourceHealthList({ sources }: { sources: readonly SourceHealth[] }) {
  const sorted = [...sources].sort((a, b) => Number(a.ok) - Number(b.ok));
  const missing = CORE_SOURCES.filter((kind) => !sources.some((s) => s.source === kind));
  const okCount = sources.filter((s) => s.ok).length;
  const total = sources.length + missing.length;
  return (
    <section className="sh-sources" aria-labelledby="sh-sources-title">
      <h2 id="sh-sources-title" className="sh-sources__head ui-label">
        <span className="sh-collapse">Fuentes</span>
        <span className="sh-sources__sum num" data-testid="sources-summary" title={`${okCount} de ${total} fuentes con datos`}>
          {okCount}/{total}
        </span>
      </h2>
      <ul className="sh-sources__list">
        {sorted.map((s) => (
          <li
            key={`${s.source}:${s.machineId ?? ""}`}
            className="sh-source"
            data-testid="source-item"
            data-state={s.ok ? "ok" : "failing"}
            title={s.error ? `${sourceLabel(s)}: ${s.error}` : sourceLabel(s)}
          >
            <StatusDot tone={s.ok ? "ok" : "danger"} label={s.ok ? "ok" : "con error"} />
            <span className="sh-source__name sh-collapse">{sourceLabel(s)}</span>
            <span className="sh-source__when num sh-collapse">
              <RelativeTime value={s.lastSuccessAt} format={spanEs} fallback="nunca" />
            </span>
          </li>
        ))}
        {missing.map((kind) => (
          <li
            key={kind}
            className="sh-source"
            data-testid="source-item"
            data-state="missing"
            title={`${SOURCE_SETUP[kind].name} sin conectar. ${SOURCE_SETUP[kind].connect}`}
          >
            <StatusDot tone="dormant" label="sin conectar" />
            <span className="sh-source__name sh-collapse">{kind}</span>
            <span className="sh-source__when sh-collapse">sin conectar</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
