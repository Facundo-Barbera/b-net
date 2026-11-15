import { Stat, StatStrip, type Tone } from "../../components/index.ts";
import { DASH, formatMs } from "../../lib/format.ts";
import { LATENCY_WARN_MS } from "../../lib/thresholds.ts";
import type { Summary } from "./derive.ts";

function Tile({ id, label, value, total, sub, tone }: { id: string; label: string; value: string | number; total?: number; sub?: string; tone?: Tone }) {
  return (
    <Stat
      data-testid={`sum-${id}`}
      label={label}
      value={
        <>
          {value}
          {total !== undefined && <small>/{total}</small>}
        </>
      }
      hint={sub}
      tone={tone}
    />
  );
}

export function SummaryStrip({ summary }: { summary: Summary }) {
  const s = summary;
  const extra = [s.paused ? `${s.paused} paused` : null, s.unknown ? `${s.unknown} unknown` : null].filter(Boolean).join(" · ");
  return (
    <StatStrip aria-label="Fleet summary">
      <Tile id="online" label="Online" value={s.online} total={s.total} sub={extra || "all reachable"} tone={s.online === s.total ? "ok" : undefined} />
      <Tile id="degraded" label="Degraded" value={s.degraded} sub={s.degraded ? "needs a look" : "none"} tone={s.degraded ? "warn" : undefined} />
      <Tile id="offline" label="Offline" value={s.offline} sub={s.offline ? "unreachable" : "none"} tone={s.offline ? "danger" : undefined} />
      <Tile id="awake" label="Sandboxes awake" value={s.awake} sub="active + waiting + idle" tone={s.awake ? "ok" : undefined} />
      <Tile id="dormant" label="Sandboxes dormant" value={s.dormant} sub="no live session" />
      <Tile
        id="latency"
        label="Worst latency"
        value={s.worst ? formatMs(s.worst.latencyMs) : DASH}
        sub={s.worst ? s.worst.machine.name : "no measurements"}
        tone={s.worst && s.worst.latencyMs > LATENCY_WARN_MS ? "warn" : undefined}
      />
    </StatStrip>
  );
}
