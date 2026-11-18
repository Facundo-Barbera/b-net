import type { GpuMetrics, MachineView, SourceHealth } from "@b-net/core";
import { Badge, Callout, Card, KV, KeyValue, Meter, RelativeTime, StatusDot, Tag, toneForMachineStatus, toneForServiceStatus, type Tone } from "../../components/index.ts";
import { SOURCE_SETUP } from "../../data/sources.ts";
import { DASH, formatBps, formatDuration, formatUsedOfGb } from "../../lib/format.ts";
import { spanEs } from "../../lib/spanish.ts";
import { STALE_METRICS_MS, TEMP_DANGER_C, TEMP_WARN_C } from "../../lib/thresholds.ts";
import { OS_LABEL, ROLE_LABEL, STATUS_LABEL, ageMs, ago, awake, linkLabel, metricsNote } from "./derive.ts";

const TEMP_FLAG: Partial<Record<Tone, string>> = { warn: " · alta", danger: " · crítica" };

/** "37 % · 1.0 / 8.0 GB · 52 °C" (missing parts become a dash). */
function gpuLabel(g: GpuMetrics): string {
  const util = g.utilPct === null ? DASH : `${Math.round(g.utilPct)} %`;
  const mem = g.memUsedMb === null || g.memTotalMb === null ? DASH : formatUsedOfGb(g.memUsedMb / 1024, g.memTotalMb / 1024);
  const temp = g.tempC === null ? DASH : `${Math.round(g.tempC)} °C`;
  return `${util} · ${mem} · ${temp}`;
}

export function MachineCard({
  m, isHub, selected, nowMs, sources, onSelect,
}: { m: MachineView; isHub: boolean; selected: boolean; nowMs: number; sources: readonly SourceHealth[]; onSelect: () => void }) {
  const tone = toneForMachineStatus(m.status);
  const met = m.metrics;
  const note = metricsNote(m, sources);
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
      aria-label={`Tarjeta de ${m.name}`}
    >
      <header className="mv-card__head">
        <button type="button" className="mv-card__select" aria-pressed={selected} aria-label={`Ver detalle de ${m.name}`} onClick={onSelect}>
          <span className="mv-card__name">{m.name}</span>
        </button>
        {isHub && <Badge tone="accent">HUB</Badge>}
        <Badge dot tone={tone} data-testid={`status-${m.id}`}>{STATUS_LABEL[m.status]}</Badge>
      </header>
      <p className="mv-card__sub">
        {ROLE_LABEL[m.role]} · {OS_LABEL[m.os]}
        {m.metricsSource === "none" && <Tag className="mv-card__nosrc">sin métricas</Tag>}
      </p>

      {met ? (
        <div className="mv-meters" data-stale={stale || undefined}>
          <Meter label="CPU" value={met.cpuPct} />
          <Meter label="RAM" value={met.memPct} detail={formatUsedOfGb(met.memUsedGb, met.memTotalGb)} />
          <Meter label="Disco" value={met.diskPct} detail={formatUsedOfGb(met.diskUsedGb, met.diskTotalGb)} />
        </div>
      ) : null}
      {note && (
        <Callout tone={note.tone} role="status" icon={<StatusDot tone={note.tone} />} data-testid={`note-${m.id}`}>
          <p>{note.text}</p>
          {note.noSource && (
            <p className="mv-card__how u-muted">
              Conecta {SOURCE_SETUP.beszel.name} (beszelName en machines.json) o instala el agente (agentUrl).
            </p>
          )}
        </Callout>
      )}

      <KeyValue>
        <KV label="Tailscale">{m.tailscale.ip ?? DASH}</KV>
        <KV label="Enlace">{isHub ? "hub" : linkLabel(m)}</KV>
        <KV label="Visto">{m.tailscale.online ? "ahora" : <RelativeTime value={m.tailscale.lastSeen} format={spanEs} fallback="nunca" />}</KV>
        <KV label="Sandboxes">{a} activos · {m.threadCounts.dormant} dormidos</KV>
        {met && (
          <>
            <KV label="Carga 1m">{met.load1 == null ? DASH : met.load1.toFixed(2)}</KV>
            <KV label="Red ↓ / ↑">{`${formatBps(met.netRxBps)} / ${formatBps(met.netTxBps)}`}</KV>
            <KV label="Uptime">{formatDuration(met.uptimeSec)}</KV>
            <KV label="Temp" tone={tempTone}>
              {met.tempC == null ? DASH : `${Math.round(met.tempC)} °C${tempTone ? TEMP_FLAG[tempTone] : ""}`}
            </KV>
            {met.gpu && (
              <KV label="GPU" title={met.gpu.count > 1 ? `${met.gpu.name} (+${met.gpu.count - 1})` : met.gpu.name}>
                {gpuLabel(met.gpu)}
              </KV>
            )}
          </>
        )}
        {m.metricsSource !== "none" && (
          <KV label="Métricas" tone={stale ? "warn" : undefined}>
            {`${m.metricsSource} · ${ago(m.metricsAt, nowMs)}`}
            {stale && " (desactualizadas)"}
            {met?.wslVm && <span title="CPU, RAM, disco y red son los de la VM de WSL, no del Windows anfitrión"> · WSL VM</span>}
          </KV>
        )}
      </KeyValue>

      {m.services.length > 0 && (
        <div className="mv-services">
          <span className="ui-label">Servicios{servicesDown > 0 ? ` · ${servicesDown} down` : ""}</span>
          <ul aria-label={`Servicios de ${m.name}`}>
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
