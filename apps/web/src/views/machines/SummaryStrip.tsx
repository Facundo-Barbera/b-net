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
  const extra = [
    s.noMetrics ? `${s.noMetrics} sin métricas` : null,
    s.paused ? `${s.paused} paused` : null,
    s.unknown ? `${s.unknown} unknown` : null,
  ].filter(Boolean).join(" · ");
  return (
    <StatStrip aria-label="Resumen de la flota">
      <Tile id="online" label="Online" value={s.online} total={s.total} sub={extra || "todas alcanzables"} tone={s.online === s.total ? "ok" : undefined} />
      <Tile id="degraded" label="Degraded" value={s.degraded} sub={s.degraded ? "requiere atención" : "ninguna"} tone={s.degraded ? "warn" : undefined} />
      <Tile id="offline" label="Offline" value={s.offline} sub={s.offline ? "inalcanzable" : "ninguna"} tone={s.offline ? "danger" : undefined} />
      <Tile id="awake" label="Sandboxes activos" value={s.awake} sub="active + waiting + idle" />
      <Tile id="dormant" label="Sandboxes dormidos" value={s.dormant} sub="sin sesión viva" />
      <Tile
        id="latency"
        label="Peor latencia"
        value={s.worst ? formatMs(s.worst.latencyMs) : DASH}
        sub={s.worst ? `${s.worst.machine.name}${s.worst.latencyMs > LATENCY_WARN_MS ? " · alta" : ""}` : "sin mediciones"}
        tone={s.worst && s.worst.latencyMs > LATENCY_WARN_MS ? "warn" : undefined}
      />
    </StatStrip>
  );
}
