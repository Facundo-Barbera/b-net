import type { SourceHealth } from "@b-net/core";
import { RelativeTime } from "../components/RelativeTime.tsx";
import { StatusDot } from "../components/StatusDot.tsx";

export function sourceLabel(s: SourceHealth): string {
  return s.machineId ? `${s.source} · ${s.machineId}` : s.source;
}

/** Sidebar block: one row per hub data source (failing ones first), with last success time. */
export function SourceHealthList({ sources }: { sources: readonly SourceHealth[] }) {
  const sorted = [...sources].sort((a, b) => Number(a.ok) - Number(b.ok));
  const okCount = sources.filter((s) => s.ok).length;
  return (
    <section className="sh-sources" aria-labelledby="sh-sources-title">
      <h2 id="sh-sources-title" className="sh-sources__head ui-label">
        <span className="sh-collapse">Sources</span>
        <span className="sh-sources__sum num" data-testid="sources-summary">
          {okCount}/{sources.length}
        </span>
      </h2>
      {sources.length === 0 ? (
        <p className="sh-sources__empty sh-collapse">No data yet</p>
      ) : (
        <ul className="sh-sources__list">
          {sorted.map((s) => (
            <li
              key={`${s.source}:${s.machineId ?? ""}`}
              className="sh-source"
              data-testid="source-item"
              data-ok={s.ok}
              title={s.error ? `${sourceLabel(s)}: ${s.error}` : sourceLabel(s)}
            >
              <StatusDot tone={s.ok ? "ok" : "danger"} label={s.ok ? "ok" : "error"} />
              <span className="sh-source__name sh-collapse">{sourceLabel(s)}</span>
              <span className="sh-source__when num sh-collapse">
                <RelativeTime value={s.lastSuccessAt} fallback="never" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
