import { cx } from "../lib/cx.ts";
import type { Tone } from "./tone.ts";

export interface StatusDotProps {
  /** ok=green, warn=amber, danger=red, idle=grey, dormant=dim grey, info=blue. */
  tone?: Tone;
  /** Accessible name. Omit when a sibling text already says it (the dot is then hidden from AT). */
  label?: string;
  /** Slow glow pulse (e.g. a running thread). Disabled by prefers-reduced-motion. */
  pulse?: boolean;
  className?: string;
}

/** Small status indicator with a subtle glow (no glow for `dormant`). */
export function StatusDot({ tone = "idle", label, pulse, className }: StatusDotProps) {
  return (
    <span
      className={cx("ui-dot", `tone-${tone}`, pulse && "ui-dot--pulse", className)}
      data-tone={tone}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
