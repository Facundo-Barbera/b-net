import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import { formatPercent } from "../lib/format.ts";
import { USAGE_DANGER_AT, USAGE_WARN_AT } from "../lib/thresholds.ts";
import { meterTone, type Tone } from "./tone.ts";

export interface MeterProps {
  /** 0–100; null/undefined renders an empty track with "—". Values are clamped. */
  value: number | null | undefined;
  /** Switches to the warn color at/above this value (default `USAGE_WARN_AT`). */
  warnAt?: number;
  /** Switches to the danger color at/above this value (default `USAGE_DANGER_AT`). */
  dangerAt?: number;
  /** Fixed color; disables the threshold logic. */
  tone?: Tone;
  /** Caption shown above the bar; also the accessible name. */
  label?: string;
  /** Accessible name when the caption is shown elsewhere (or not at all); wins over `label` for AT. */
  ariaLabel?: string;
  /** Show the numeric value (mono) next to the label. Default true when `label` is set. */
  showValue?: boolean;
  /** Override the displayed text (e.g. "12.9 / 23.9 GB"). */
  valueText?: string;
  /**
   * Prefix the value with HIGH / CRIT past a threshold so state does not rely on color alone (default on).
   * Turn off only when the caller states the level in words next to the meter.
   */
  flag?: boolean;
  /** Muted mono line under the bar (e.g. "5.3 / 7.5 GB"). */
  detail?: ReactNode;
  className?: string;
}

const FLAG: Partial<Record<Tone, string>> = { warn: "HIGH", danger: "CRIT" };

/** Horizontal 0–100 bar that turns amber/red past thresholds. */
export function Meter({
  value, warnAt = USAGE_WARN_AT, dangerAt = USAGE_DANGER_AT, tone, label, ariaLabel, showValue, valueText, flag = true, detail, className,
}: MeterProps) {
  const has = typeof value === "number" && Number.isFinite(value);
  const v = has ? Math.min(100, Math.max(0, value)) : 0;
  const t = tone ?? (has ? meterTone(v, warnAt, dangerAt) : "dormant");
  const text = valueText ?? formatPercent(has ? v : null);
  const display = showValue ?? label != null;
  const flagText = flag && has ? FLAG[t] : undefined;
  return (
    <div className={cx("ui-meter", `tone-${t}`, className)} data-tone={t}>
      {(label != null || display) && (
        <div className="ui-meter__row">
          {label != null && <span className="ui-label">{label}</span>}
          {display && (
            <span className="ui-meter__value num">
              {flagText && <span className="ui-meter__flag">{flagText}</span>}
              {text}
            </span>
          )}
        </div>
      )}
      <div
        className="ui-meter__track"
        role="meter"
        aria-label={ariaLabel ?? label ?? "Usage"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={has ? Math.round(v) : undefined}
        aria-valuetext={text}
      >
        <div className="ui-meter__fill" style={{ width: `${v}%` }} />
      </div>
      {detail != null && <div className="ui-meter__detail num">{detail}</div>}
    </div>
  );
}
