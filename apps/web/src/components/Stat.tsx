import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import type { Tone } from "./tone.ts";

export interface StatProps extends Omit<HTMLAttributes<HTMLDListElement>, "children"> {
  /** Small uppercase caption. */
  label: ReactNode;
  /** The metric; rendered in mono tabular numerals. */
  value: ReactNode;
  /** Muted suffix next to the value ("GB", "req/h"). */
  unit?: ReactNode;
  /** Muted line under the value. */
  hint?: ReactNode;
  /** Colors the value (e.g. danger for a high error count). */
  tone?: Tone;
}

/** Label + big mono value, the building block for KPI rows. */
export function Stat({ label, value, unit, hint, tone, className, ...rest }: StatProps) {
  return (
    <dl className={cx("ui-stat", tone && `tone-${tone}`, className)} {...rest}>
      <dt className="ui-label">{label}</dt>
      <dd className="ui-stat__value num">
        {value}
        {unit != null && <span className="ui-stat__unit">{unit}</span>}
      </dd>
      {hint != null && <dd className="ui-stat__hint">{hint}</dd>}
    </dl>
  );
}
