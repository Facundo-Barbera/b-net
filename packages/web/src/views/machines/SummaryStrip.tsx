import type { Summary } from "./derive.ts";
import { ms } from "./format.ts";

function Tile({ id, label, value, total, sub, tone }: { id: string; label: string; value: string | number; total?: number; sub?: string; tone?: string }) {
  return (
    <li className="mv-tile" data-testid={`sum-${id}`} data-tone={tone}>
      <span className="mv-label">{label}</span>
      <span className="mv-tile__value num">
        {value}
        {total !== undefined && <small>/{total}</small>}
      </span>
      {sub && <span className="mv-tile__sub">{sub}</span>}
    </li>
  );
}

export function SummaryStrip({ summary }: { summary: Summary }) {
  const s = summary;
  const extra = [s.paused ? `${s.paused} paused` : null, s.unknown ? `${s.unknown} unknown` : null].filter(Boolean).join(" · ");
  return (
    <ul className="mv-summary" aria-label="Fleet summary">
      <Tile id="online" label="Online" value={s.online} total={s.total} sub={extra || "all reachable"} tone={s.online === s.total ? "ok" : undefined} />
      <Tile id="degraded" label="Degraded" value={s.degraded} sub={s.degraded ? "needs a look" : "none"} tone={s.degraded ? "warn" : undefined} />
      <Tile id="offline" label="Offline" value={s.offline} sub={s.offline ? "unreachable" : "none"} tone={s.offline ? "danger" : undefined} />
      <Tile id="awake" label="Sandboxes awake" value={s.awake} sub="active + waiting + idle" tone={s.awake ? "ok" : undefined} />
      <Tile id="dormant" label="Sandboxes dormant" value={s.dormant} sub="no live session" />
      <Tile
        id="latency"
        label="Worst latency"
        value={s.worst ? ms(s.worst.latencyMs) : "—"}
        sub={s.worst ? s.worst.machine.name : "no measurements"}
        tone={s.worst && s.worst.latencyMs > 250 ? "warn" : undefined}
      />
    </ul>
  );
}
