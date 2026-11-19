import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";
import { StatusDot } from "./StatusDot.tsx";
import type { Tone } from "./tone.ts";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Color family (default neutral). */
  tone?: Tone;
  /** "soft" = tinted fill (default), "outline" = border only. */
  variant?: "soft" | "outline";
  /** Prefix the tone's status glyph (shape per tone, see ToneGlyph). */
  dot?: boolean;
}

/** Compact uppercase pill for statuses, counts and modes. */
export function Badge({ tone = "neutral", variant = "soft", dot, className, children, ...rest }: BadgeProps) {
  return (
    <span className={cx("ui-badge", `ui-badge--${variant}`, `tone-${tone}`, className)} {...rest}>
      {dot && <StatusDot tone={tone} className="ui-badge__dot" />}
      {children}
    </span>
  );
}
