import type { MachineView } from "@b-net/core";
import { Badge, Callout, Card, KV, KeyValue, Meter, RelativeTime, StatusDot, toneForMachineStatus, toneForServiceStatus, type Tone } from "../../components/index.ts";
import { DASH, formatBps, formatDuration, formatUsedOfGb } from "../../lib/format.ts";
import { STALE_METRICS_MS, TEMP_DANGER_C, TEMP_WARN_C } from "../../lib/thresholds.ts";
import { OS_LABEL, ROLE_LABEL, STATUS_LABEL, ageMs, ago, awake, linkLabel, metricsNote } from "./derive.ts";

export function MachineCard({
  m, isHub, selected, nowMs, onSelect,
}: { m: MachineView; isHub: boolean; selected: boolean; nowMs: number; onSelect: () => void }) {
  const tone = toneForMachineStatus(m.status);
  const met = m.metrics;
  const note = metricsNote(m);
  const age = ageMs(m.metricsAt, nowMs);
  const stale = met !== null && age !== null && age > STALE_METRICS_MS;
  const down = m.status === "offline" || m.status === "paused";
  const a = awake(m.threadCounts);
  const tempTone: Tone | undefined = met?.tempC == null ? undefined : met.tempC >= TEMP_DANGER_C ? "danger" : met.tempC >= TEMP_WARN_C ? "warn" : undefined;
  const servicesDown = m.services.filter((s) => s.status === "down").length;

  return (
    <Card
      as="article"
      className="mv-card"
      bodyClassName="mv-card__body"
      data-testid={`card-${m.id}`}
      data-selected={selected || undefined}
      data-down={down || undefined}
      aria-label={`${m.name} card`}
    >
      <header className="mv-card__head">
        <button type="button" className="mv-card__select" aria-pressed={selected} aria-label={`Show details for ${m.name}`} onClick={onSelect}>
          <StatusDot tone={tone} />
          <span className="mv-card__name">{m.name}</span>
        </button>
        {isHub && <Badge tone="accent">HUB</Badge>}
        <Badge tone={tone} data-testid={`status-${m.id}`}>{STATUS_LABEL[m.status]}</Badge>
      </header>
      <p className="mv-card__sub">{ROLE_LABEL[m.role]} · {OS_LABEL[m.os]}</p>

      {met ? (
        <div className="mv-meters" data-stale={stale || undefined}>
          <Meter label="CPU" value={met.cpuPct} flag />
          <Meter label="RAM" value={met.memPct} flag detail={formatUsedOfGb(met.memUsedGb, met.memTotalGb)} />
          <Meter label="Disk" value={met.diskPct} flag detail={formatUsedOfGb(met.diskUsedGb, met.diskTotalGb)} />
        </div>
      ) : null}
      {note && <Callout tone={tone === "ok" ? "idle" : tone} role="status">{note}</Callout>}

      <KeyValue>
        <KV label="Tailscale">{m.tailscale.ip ?? DASH}</KV>
        <KV label="Latency">{isHub ? "hub" : linkLabel(m)}</KV>
        <KV label="Last seen">{m.tailscale.online ? "now" : <RelativeTime value={m.tailscale.lastSeen} fallback="never" />}</KV>
        <KV label="Load 1m">{met?.load1 == null ? DASH : met.load1.toFixed(2)}</KV>
        <KV label="Net ↓ / ↑">{met ? `${formatBps(met.netRxBps)} / ${formatBps(met.netTxBps)}` : DASH}</KV>
        <KV label="Uptime">{met ? formatDuration(met.uptimeSec) : DASH}</KV>
        <KV label="Temp" tone={tempTone}>{met?.tempC == null ? DASH : `${Math.round(met.tempC)} °C`}</KV>
        <KV label="Metrics" tone={stale ? "warn" : undefined}>
          {m.metricsSource === "none" ? "none" : `${m.metricsSource} · ${ago(m.metricsAt, nowMs)}`}
          {stale && " (stale)"}
        </KV>
        <KV label="Sandboxes">{a} awake · {m.threadCounts.dormant} dormant</KV>
      </KeyValue>

      {m.services.length > 0 && (
        <div className="mv-services">
          <span className="ui-label">Services{servicesDown > 0 ? ` · ${servicesDown} down` : ""}</span>
          <ul aria-label={`${m.name} services`}>
            {m.services.map((s) => {
              const st = toneForServiceStatus(s.status);
              return (
                <li key={s.name} className={`mv-svc tone-${st}`} data-status={s.status}>
                  <StatusDot tone={st} />
                  <span>{s.name}</span>
                  {s.port !== null && <span className="num mv-svc__port">:{s.port}</span>}
                  <span className="mv-svc__state">{s.status}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {m.notes && <p className="mv-card__notes">{m.notes}</p>}
    </Card>
  );
}
