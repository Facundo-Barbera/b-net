import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Count shown after the label (mono), so a filter says how much it keeps before you press it. */
  count?: number;
}

export interface SegmentedProps<T extends string> {
  /** Accessible name of the group ("Filtrar proyectos"). */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * Small toggle group for view filters. Buttons expose `aria-pressed`; the pressed one is filled and bold,
 * so the selection does not rely on colour alone.
 */
export function Segmented<T extends string>({ label, options, value, onChange, className }: SegmentedProps<T>) {
  return (
    <div className={cx("ui-seg", className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="ui-seg__btn" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && <span className="ui-seg__count num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
