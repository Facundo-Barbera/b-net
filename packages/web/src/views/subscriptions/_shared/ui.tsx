import { useId } from "react";
import type { ReactNode } from "react";
import "./shared.css";

/** View-local primitives (prefix `vx-`). May be consolidated into src/components later. */
export type Tone = "ok" | "warn" | "danger" | "info" | "idle" | "dormant" | "accent" | "muted";

export function Dot({ tone }: { tone: Tone }) {
  return <span className={`vx-dot vx-tone-${tone}`} aria-hidden="true" />;
}

export function Badge({ tone, dot = true, children, title }: { tone: Tone; dot?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={`vx-badge vx-tone-${tone}`} title={title}>
      {dot ? <Dot tone={tone} /> : null}
      {children}
    </span>
  );
}

export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="vx-tag" title={title}>
      {children}
    </span>
  );
}

export function Panel({
  title,
  aside,
  children,
  className = "",
  testId,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={`vx-panel ${className}`} data-testid={testId}>
      {title || aside ? (
        <header className="vx-panel-head">
          <h2 className="vx-eyebrow">{title}</h2>
          {aside ? <div className="vx-panel-aside">{aside}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone, testId }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone; testId?: string }) {
  return (
    <div className={`vx-kpi ${tone ? `vx-tone-${tone}` : ""}`} data-testid={testId}>
      <div className="vx-eyebrow">{label}</div>
      <div className={`vx-kpi-value num ${tone ? "vx-kpi-toned" : ""}`}>{value}</div>
      {sub ? <div className="vx-kpi-sub">{sub}</div> : null}
    </div>
  );
}

/** ISO instant with the exact value in the tooltip. */
export function Time({ iso, children }: { iso: string; children: ReactNode }) {
  return (
    <time dateTime={iso} title={iso}>
      {children}
    </time>
  );
}

/**
 * Horizontal meter drawn as inline SVG. `pct === null` renders a hatched "no data" track.
 */
export function Meter({ pct, tone, label, height = 8 }: { pct: number | null; tone: Tone; label: string; height?: number }) {
  const uid = useId();
  const hatch = `hatch-${uid.replace(/:/g, "")}`;
  const aria =
    pct === null
      ? { "aria-valuetext": "sin dato" }
      : { "aria-valuenow": Math.round(pct), "aria-valuetext": `${Math.round(pct)}%` };
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} {...aria} className={`vx-meter vx-tone-${tone}`}>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" width="100%" height={height} aria-hidden="true" focusable="false">
        {pct === null ? (
          <defs>
            <pattern id={hatch} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" className="vx-meter-hatch" strokeWidth="1.2" />
            </pattern>
          </defs>
        ) : null}
        <rect x="0" y="0" width="100" height={height} className="vx-meter-track" />
        {pct === null ? (
          <rect x="0" y="0" width="100" height={height} fill={`url(#${hatch})`} />
        ) : (
          <rect x="0" y="0" width={Math.max(0, Math.min(100, pct))} height={height} className="vx-meter-fill" />
        )}
        {[25, 50, 75].map((x) => (
          <line key={x} x1={x} x2={x} y1="0" y2={height} className="vx-meter-tick" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}

export function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className="vx-icon">
      <rect x="3" y="7" width="10" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}
