/** Small view-local building blocks (may be consolidated into src/components later). */
import { useEffect, useState } from "react";
import { LEVEL_FLAG, level, type Tone } from "./derive.ts";

export function Dot({ tone, label }: { tone: Tone; label?: string }) {
  return <span className="mv-dot" data-tone={tone} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** Horizontal meter. warn > 75, danger > 90; the flag text keeps it readable without color. */
export function Meter({ label, pct, detail }: { label: string; pct: number; detail?: string }) {
  const lv = level(pct);
  const flag = LEVEL_FLAG[lv];
  return (
    <div className="mv-meter" data-level={lv}>
      <div className="mv-meter__head">
        <span className="mv-label">{label}</span>
        <span className="num mv-meter__val">
          {flag && <span className="mv-flag">{flag}</span>}
          {Math.round(pct)}%
        </span>
      </div>
      <div className="mv-meter__bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
        <span style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      {detail && <div className="mv-meter__detail num">{detail}</div>}
    </div>
  );
}

/** Dependency-free sparkline for a 0..100 series. */
export function Sparkline({ values, label, stepSec, series }: { values: number[]; label: string; stepSec: number; series: 1 | 2 }) {
  if (values.length < 2) return <div className="mv-spark mv-spark--empty">no history</div>;
  const W = 160;
  const H = 40;
  const n = values.length;
  const pts = values.map((v, i) => [(i / (n - 1)) * W, H - 2 - (Math.min(100, Math.max(0, v)) / 100) * (H - 4)] as const);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const last = values[n - 1]!;
  const minutes = Math.round((stepSec * (n - 1)) / 60);
  const avg = values.reduce((a, b) => a + b, 0) / n;
  return (
    <svg
      className="mv-spark"
      data-series={series}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${label} history, last ${minutes} min: now ${Math.round(last)}%, average ${Math.round(avg)}%, min ${Math.round(Math.min(...values))}%, max ${Math.round(Math.max(...values))}%`}
    >
      <line x1="0" x2={W} y1={H - 2 - 0.75 * (H - 4)} y2={H - 2 - 0.75 * (H - 4)} className="mv-spark__ref" />
      <path d={area} className="mv-spark__area" />
      <path d={line} className="mv-spark__line" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** True below the topology breakpoint. SSR/jsdom without matchMedia => wide. */
export function useNarrow(query = "(max-width: 640px)"): boolean {
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
