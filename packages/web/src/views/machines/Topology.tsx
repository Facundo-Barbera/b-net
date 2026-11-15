import { useEffect, useState, type KeyboardEvent } from "react";
import type { MachineView } from "@b-net/core";
import { Card, StatusDot, meterTone, toneForMachineStatus } from "../../components/index.ts";
import { formatPercent } from "../../lib/format.ts";
import { OS_LABEL, ROLE_LABEL, STATUS_LABEL, awake, linkKind, linkLabel } from "./derive.ts";

/** True below the topology breakpoint. SSR/jsdom without matchMedia => wide. */
function useNarrow(query = "(max-width: 640px)"): boolean {
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [narrow, setNarrow] = useState(() => (supported ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query, supported]);
  return narrow;
}

interface TopologyProps {
  machines: MachineView[];
  hubId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const W = 900;
const H = 480;
const CX = W / 2;
const CY = H / 2;
const RX = 320;
const RY = 168;
const NODE_W = 168;
const NODE_H = 90;
const HUB_W = 188;
const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

function metricsText(m: MachineView): string {
  if (!m.metrics) return "no metrics";
  return `CPU ${formatPercent(m.metrics.cpuPct)}, RAM ${formatPercent(m.metrics.memPct)}`;
}

/** Accessible name shared by SVG nodes and the narrow list rows. */
export function machineLabel(m: MachineView, hubId: string): string {
  const isHub = m.id === hubId;
  const net = isHub ? "hub" : `link ${linkLabel(m)}`;
  const a = awake(m.threadCounts);
  return `${m.name}${isHub ? " (hub)" : ""}: ${STATUS_LABEL[m.status].toLowerCase()}, ${net}, ${metricsText(m)}, ${a} awake and ${m.threadCounts.dormant} dormant sandboxes`;
}

function Ring({ cx, cy, pct, label }: { cx: number; cy: number; pct: number; label: string }) {
  return (
    <g className={`mv-ring tone-${meterTone(pct)}`}>
      <circle cx={cx} cy={cy} r={RING_R} className="mv-ring__track" />
      <circle
        cx={cx}
        cy={cy}
        r={RING_R}
        className="mv-ring__arc"
        strokeDasharray={`${(Math.min(100, pct) / 100) * RING_C} ${RING_C}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx + RING_R + 5} y={cy + 3.5} className="mv-svg-num">
        {label} {formatPercent(pct)}
      </text>
    </g>
  );
}

function Node({
  m, x, y, w, isHub, selected, dimmed, onSelect, onHover, hubId,
}: {
  m: MachineView; x: number; y: number; w: number; isHub: boolean; selected: boolean; dimmed: boolean;
  onSelect: () => void; onHover: (on: boolean) => void; hubId: string;
}) {
  const tone = toneForMachineStatus(m.status);
  const a = awake(m.threadCounts);
  const down = m.status === "offline" || m.status === "paused";
  const onKey = (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }
  };
  return (
    <g
      className={`mv-node tone-${tone}`}
      data-selected={selected || undefined}
      data-hub={isHub || undefined}
      data-faded={down || dimmed || undefined}
      transform={`translate(${x - w / 2} ${y - NODE_H / 2})`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={machineLabel(m, hubId)}
      onClick={onSelect}
      onKeyDown={onKey}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
    >
      <rect width={w} height={NODE_H} rx={8} className="mv-node__box" />
      <circle cx={14} cy={17} r={4} className="mv-node__dot" />
      <text x={26} y={21} className="mv-node__name">{m.name}</text>
      {isHub && <text x={w - 10} y={21} textAnchor="end" className="mv-node__hub">HUB</text>}
      <text x={14} y={37} className="mv-node__sub">
        {ROLE_LABEL[m.role]} · {OS_LABEL[m.os]}
      </text>
      {m.metrics ? (
        <g opacity={down ? 0.6 : 1}>
          <Ring cx={24} cy={57} pct={m.metrics.cpuPct} label="CPU" />
          <Ring cx={w / 2 + 12} cy={57} pct={m.metrics.memPct} label="RAM" />
        </g>
      ) : (
        <text x={14} y={60} className="mv-node__empty">
          {m.status === "offline" ? "offline · no metrics" : m.status === "paused" ? "paused · no metrics" : "no metrics"}
        </text>
      )}
      <line x1={10} x2={w - 10} y1={72} y2={72} className="mv-node__rule" />
      <text x={14} y={85} className="mv-svg-num mv-node__sand">
        <tspan className="mv-node__awake">{a} awake</tspan>
        <tspan dx={8}>{m.threadCounts.dormant} dormant</tspan>
      </text>
    </g>
  );
}

function SvgMap({ machines, hubId, selectedId, onSelect }: TopologyProps) {
  const [hover, setHover] = useState<string | null>(null);
  const hub = machines.find((m) => m.id === hubId) ?? machines[0];
  if (!hub) return null;
  const others = machines.filter((m) => m !== hub);
  const pos = others.map((m, i) => {
    const ang = (-90 + (i * 360) / others.length) * (Math.PI / 180);
    return { m, x: CX + RX * Math.cos(ang), y: CY + RY * Math.sin(ang) };
  });
  const focus = hover ?? selectedId;

  return (
    <svg className="mv-map" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Machine topology" data-testid="topology-svg">
      <g className="mv-links" aria-hidden="true">
        {pos.map(({ m, x, y }) => {
          const kind = linkKind(m);
          const text = linkLabel(m);
          const mx = (CX + x) / 2;
          const my = (CY + y) / 2;
          const lw = text.length * 6 + 14;
          return (
            <g key={m.id} className="mv-link" data-kind={kind} data-active={focus === m.id || undefined} data-link-for={m.id}>
              <line x1={CX} y1={CY} x2={x} y2={y} className="mv-link__line" />
              <rect x={mx - lw / 2} y={my - 9} width={lw} height={18} rx={4} className="mv-link__bg" />
              <text x={mx} y={my + 3.5} textAnchor="middle" className="mv-link__label">{text}</text>
            </g>
          );
        })}
      </g>
      <Node m={hub} x={CX} y={CY} w={HUB_W} isHub selected={selectedId === hub.id} dimmed={false} hubId={hubId}
        onSelect={() => onSelect(hub.id)} onHover={(on) => setHover(on ? hub.id : null)} />
      {pos.map(({ m, x, y }) => (
        <Node key={m.id} m={m} x={x} y={y} w={NODE_W} isHub={false} selected={selectedId === m.id} dimmed={false} hubId={hubId}
          onSelect={() => onSelect(m.id)} onHover={(on) => setHover(on ? m.id : null)} />
      ))}
    </svg>
  );
}

/** Narrow-screen fallback: the same information as a stacked list. */
function ListMap({ machines, hubId, selectedId, onSelect }: TopologyProps) {
  const ordered = [...machines].sort((a, b) => Number(b.id === hubId) - Number(a.id === hubId));
  return (
    <ul className="mv-maplist" aria-label="Machine topology" data-testid="topology-list">
      {ordered.map((m) => {
        const isHub = m.id === hubId;
        const a = awake(m.threadCounts);
        return (
          <li key={m.id}>
            <button
              type="button"
              className={`mv-maplist__row tone-${toneForMachineStatus(m.status)}`}
              data-selected={selectedId === m.id || undefined}
              data-kind={isHub ? "hub" : linkKind(m)}
              aria-pressed={selectedId === m.id}
              aria-label={machineLabel(m, hubId)}
              onClick={() => onSelect(m.id)}
            >
              <StatusDot tone={toneForMachineStatus(m.status)} />
              <span className="mv-maplist__name">{m.name}{isHub && <span className="mv-node__hub"> HUB</span>}</span>
              <span className="mv-maplist__link num">{isHub ? "hub" : linkLabel(m)}</span>
              <span className="mv-maplist__stats num">
                {m.metrics ? `CPU ${formatPercent(m.metrics.cpuPct)} · RAM ${formatPercent(m.metrics.memPct)}` : "no metrics"}
              </span>
              <span className="mv-maplist__sand num">{a} awake · {m.threadCounts.dormant} dormant</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function Topology(props: TopologyProps) {
  const narrow = useNarrow();
  return (
    <Card
      className="mv-topology"
      title="Topology"
      actions={
        <ul className="mv-legend" aria-label="Link legend">
          <li><i data-kind="direct" /> direct</li>
          <li><i data-kind="derp" /> DERP relay</li>
          <li><i data-kind="peer-relay" /> peer relay</li>
          <li><i data-kind="offline" /> offline</li>
        </ul>
      }
    >
      {narrow ? <ListMap {...props} /> : <SvgMap {...props} />}
    </Card>
  );
}
