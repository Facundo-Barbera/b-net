import { cx } from "../lib/cx.ts";
import { formatPercent } from "../lib/format.ts";
import { meterTone, type Tone } from "./tone.ts";

export interface MeterProps {
  /** 0–100; null/undefined renders an empty track with "—". Values are clamped. */
  value: number | null | undefined;
  /** Switches to the warn color at/above this value (default 70). */
  warnAt?: number;
  /** Switches to the danger color at/above this value (default 90). */
  dangerAt?: number;
  /** Fixed color; disables the threshold logic. */
  tone?: Tone;
  /** Caption shown above the bar; also the accessible name. */
  label?: string;
  /** Show the numeric value (mono) next to the label. Default true when `label` is set. */
  showValue?: boolean;
  /** Override the displayed text (e.g. "12.9 / 23.9 GB"). */
  valueText?: string;
  className?: string;
}

/** Horizontal 0–100 bar that turns amber/red past thresholds. */
export function Meter({ value, warnAt = 70, dangerAt = 90, tone, label, showValue, valueText, className }: MeterProps) {
  const has = typeof value === "number" && Number.isFinite(value);
  const v = has ? Math.min(100, Math.max(0, value)) : 0;
  const t = tone ?? (has ? meterTone(v, warnAt, dangerAt) : "dormant");
  const text = valueText ?? formatPercent(has ? v : null);
  const display = showValue ?? label != null;
  return (
    <div className={cx("ui-meter", `tone-${t}`, className)} data-tone={t}>
      {(label != null || display) && (
        <div className="ui-meter__row">
          {label != null && <span className="ui-label">{label}</span>}
          {display && <span className="ui-meter__value num">{text}</span>}
        </div>
      )}
      <div
        className="ui-meter__track"
        role="meter"
        aria-label={label ?? "Usage"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={has ? v : undefined}
        aria-valuetext={text}
      >
        <div className="ui-meter__fill" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
