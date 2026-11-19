import { cx } from "../lib/cx.ts";
import type { Tone } from "./tone.ts";
import { TONE_SHAPE, ToneGlyph } from "./ToneGlyph.tsx";

export interface StatusDotProps {
  /** Color AND shape: ok ● · warn ▲ · danger ■ · info ◆ · idle ‖ · dormant ○ (see ToneGlyph). */
  tone?: Tone;
  /** Accessible name. Omit when a sibling text already says it (the glyph is then hidden from AT). */
  label?: string;
  /** Slow pulse (e.g. a running thread). Disabled by prefers-reduced-motion. */
  pulse?: boolean;
  className?: string;
}

/** Small status glyph. The shape changes with the tone, so status never depends on color alone. */
export function StatusDot({ tone = "idle", label, pulse, className }: StatusDotProps) {
  return (
    <svg
      className={cx("ui-dot", `tone-${tone}`, pulse && "ui-dot--pulse", className)}
      viewBox="0 0 10 10"
      data-tone={tone}
      data-shape={TONE_SHAPE[tone]}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <ToneGlyph tone={tone} />
    </svg>
  );
}
