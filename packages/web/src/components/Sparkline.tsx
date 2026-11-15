import { cx } from "../lib/cx.ts";
import type { Tone } from "./tone.ts";

export interface SparklinePath {
  line: string;
  area: string;
  last: { x: number; y: number } | null;
}

/** Pure geometry for a sparkline; exported for tests. Non-finite values are dropped. */
export function buildSparkline(
  values: readonly number[],
  width: number,
  height: number,
  opts: { min?: number; max?: number; pad?: number } = {},
): SparklinePath {
  const pts = values.filter((v) => Number.isFinite(v));
  const pad = opts.pad ?? 2;
  if (pts.length < 2) return { line: "", area: "", last: null };
  const min = opts.min ?? Math.min(...pts);
  let max = opts.max ?? Math.max(...pts);
  if (max <= min) max = min + 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const xy = pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * innerW;
    const y = pad + innerH - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * innerH;
    return [+x.toFixed(2), +y.toFixed(2)] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const first = xy[0]!;
  const last = xy[xy.length - 1]!;
  const area = `${line} L${last[0]} ${height - pad} L${first[0]} ${height - pad} Z`;
  return { line, area, last: { x: last[0], y: last[1] } };
}

export interface SparklineProps {
  values: readonly number[];
  width?: number;
  height?: number;
  /** Fixed domain (e.g. 0–100 for percentages); defaults to the data range. */
  min?: number;
  max?: number;
  /** Stroke color family (default info). */
  tone?: Tone;
  /** Accessible description; without it the chart is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

/** Inline SVG trend line with a faint area and an end dot. Scales with CSS width if set. */
export function Sparkline({ values, width = 96, height = 24, min, max, tone = "info", label, className }: SparklineProps) {
  const { line, area, last } = buildSparkline(values, width, height, { min, max });
  return (
    <svg
      className={cx("ui-spark", `tone-${tone}`, className)}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {line ? (
        <>
          <path className="ui-spark__area" d={area} />
          <path className="ui-spark__line" d={line} vectorEffect="non-scaling-stroke" />
          {last && <circle className="ui-spark__dot" cx={last.x} cy={last.y} r="1.8" />}
        </>
      ) : (
        <line className="ui-spark__empty" x1="2" x2={width - 2} y1={height / 2} y2={height / 2} />
      )}
    </svg>
  );
}
