import type { MachineView } from "@bixku/core";
import { OS_LABEL, ROLE_LABEL, STALE_AFTER_MS, STATUS_LABEL, STATUS_TONE, awake, linkLabel, metricsNote } from "./derive.ts";
import { ageMs, duration, rate, relTime, usedOfTotal } from "./format.ts";
import { Dot, Meter } from "./parts.tsx";

function Row({ k, children, tone }: { k: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className="mv-kv" data-tone={tone}>
      <dt className="mv-label">{k}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

export function MachineCard({
  m, isHub, selected, nowMs, onSelect,
}: { m: MachineView; isHub: boolean; selected: boolean; nowMs: number; onSelect: () => void }) {
  const tone = STATUS_TONE[m.status];
  const met = m.metrics;
  const note = metricsNote(m);
  const age = ageMs(m.metricsAt, nowMs);
  const stale = met !== null && age !== null && age > STALE_AFTER_MS;
  const down = m.status === "offline" || m.status === "paused";
  const a = awake(m.threadCounts);
  const tempTone = met?.tempC == null ? undefined : met.tempC > 85 ? "danger" : met.tempC > 75 ? "warn" : undefined;
  const servicesDown = m.services.filter((s) => s.status === "down").length;

  return (
    <article className="mv-card" data-testid={`card-${m.id}`} data-tone={tone} data-selected={selected || undefined} data-down={down || undefined} aria-label={`${m.name} card`}>
      <header className="mv-card__head">
        <button type="button" className="mv-card__select" aria-pressed={selected} aria-label={`Show details for ${m.name}`} onClick={onSelect}>
          <Dot tone={tone} />
          <span className="mv-card__name">{m.name}</span>
        </button>
        {isHub && <span className="mv-chip mv-chip--accent">HUB</span>}
        <span className="mv-chip" data-tone={tone} data-testid={`status-${m.id}`}>{STATUS_LABEL[m.status]}</span>
      </header>
      <p className="mv-card__sub">{ROLE_LABEL[m.role]} · {OS_LABEL[m.os]}</p>

      {met ? (
        <div className="mv-meters" data-stale={stale || undefined}>
          <Meter label="CPU" pct={met.cpuPct} />
          <Meter label="RAM" pct={met.memPct} detail={usedOfTotal(met.memUsedGb, met.memTotalGb)} />
          <Meter label="Disk" pct={met.diskPct} detail={usedOfTotal(met.diskUsedGb, met.diskTotalGb)} />
        </div>
      ) : null}
      {note && <p className="mv-card__note" data-tone={tone === "ok" ? "idle" : tone} role="status">{note}</p>}

      <dl className="mv-kvs">
        <Row k="Tailscale">{m.tailscale.ip ?? "—"}</Row>
        <Row k="Latency">{isHub ? "hub" : linkLabel(m)}</Row>
        <Row k="Last seen">{m.tailscale.online ? "now" : relTime(m.tailscale.lastSeen, nowMs)}</Row>
        <Row k="Load 1m">{met?.load1 == null ? "—" : met.load1.toFixed(2)}</Row>
        <Row k="Net ↓ / ↑">{met ? `${rate(met.netRxBps)} / ${rate(met.netTxBps)}` : "—"}</Row>
        <Row k="Uptime">{met ? duration(met.uptimeSec) : "—"}</Row>
        <Row k="Temp" tone={tempTone}>{met?.tempC == null ? "—" : `${Math.round(met.tempC)} °C`}</Row>
        <Row k="Metrics" tone={stale ? "warn" : undefined}>
          {m.metricsSource === "none" ? "none" : `${m.metricsSource} · ${relTime(m.metricsAt, nowMs)}`}
          {stale && " (stale)"}
        </Row>
        <Row k="Sandboxes">{a} awake · {m.threadCounts.dormant} dormant</Row>
      </dl>

      {m.services.length > 0 && (
        <div className="mv-services">
          <span className="mv-label">Services{servicesDown > 0 ? ` · ${servicesDown} down` : ""}</span>
          <ul aria-label={`${m.name} services`}>
            {m.services.map((s) => (
              <li key={s.name} className="mv-svc" data-status={s.status} data-tone={s.status === "up" ? "ok" : s.status === "down" ? "danger" : "dormant"}>
                <Dot tone={s.status === "up" ? "ok" : s.status === "down" ? "danger" : "dormant"} />
                <span>{s.name}</span>
                {s.port !== null && <span className="num mv-svc__port">:{s.port}</span>}
                <span className="mv-svc__state">{s.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {m.notes && <p className="mv-card__notes">{m.notes}</p>}
    </article>
  );
}
