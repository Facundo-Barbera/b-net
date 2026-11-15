import { cx } from "../lib/cx.ts";
import type { Tone } from "./tone.ts";

export interface SparklinePath {
  line: string;
  area: string;
  last: { x: number; y: number } | null;
  /** y of the reference line (see `opts.ref`), when it falls inside the domain. */
  ref: number | null;
}

/** Pure geometry for a sparkline; exported for tests. Non-finite values are dropped. */
export function buildSparkline(
  values: readonly number[],
  width: number,
  height: number,
  opts: { min?: number; max?: number; pad?: number; ref?: number } = {},
): SparklinePath {
  const pts = values.filter((v) => Number.isFinite(v));
  const pad = opts.pad ?? 2;
  if (pts.length < 2) return { line: "", area: "", last: null, ref: null };
  const min = opts.min ?? Math.min(...pts);
  let max = opts.max ?? Math.max(...pts);
  if (max <= min) max = min + 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const yOf = (v: number) => pad + innerH - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * innerH;
  const xy = pts.map((v, i) => {
    const x = pad + (i / (pts.length - 1)) * innerW;
    return [+x.toFixed(2), +yOf(v).toFixed(2)] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const first = xy[0]!;
  const last = xy[xy.length - 1]!;
  const area = `${line} L${last[0]} ${height - pad} L${first[0]} ${height - pad} Z`;
  const ref = opts.ref != null && opts.ref >= min && opts.ref <= max ? +yOf(opts.ref).toFixed(2) : null;
  return { line, area, last: { x: last[0], y: last[1] }, ref };
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
  /** Chart palette slot (`--chart-N`); overrides `tone` so several series stay distinguishable. */
  series?: 1 | 2 | 3 | 4;
  /** Fill the container width (the viewBox is stretched; `width` only sets the coordinate space). */
  stretch?: boolean;
  /** Draw a faint dashed reference line at this value (e.g. a warn threshold). */
  refLine?: number;
  /** Accessible description; without it the chart is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

/** Inline SVG trend line with a faint area and an end dot. Scales with CSS width if set. */
export function Sparkline({ values, width = 96, height = 24, min, max, tone = "info", series, stretch, refLine, label, className }: SparklineProps) {
  const { line, area, last, ref } = buildSparkline(values, width, height, { min, max, ref: refLine });
  return (
    <svg
      className={cx("ui-spark", `tone-${tone}`, series && `ui-spark--s${series}`, stretch && "ui-spark--stretch", className)}
      viewBox={`0 0 ${width} ${height}`}
      width={stretch ? "100%" : width}
      height={height}
      preserveAspectRatio={stretch ? "none" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {line ? (
        <>
          {ref != null && <line className="ui-spark__ref" x1="0" x2={width} y1={ref} y2={ref} vectorEffect="non-scaling-stroke" />}
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
