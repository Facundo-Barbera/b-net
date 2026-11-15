import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";
import type { Tone } from "./tone.ts";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Color family (default neutral). */
  tone?: Tone;
  /** "soft" = tinted fill (default), "outline" = border only. */
  variant?: "soft" | "outline";
}

/** Compact uppercase pill for statuses, counts and modes. */
export function Badge({ tone = "neutral", variant = "soft", className, ...rest }: BadgeProps) {
  return <span className={cx("ui-badge", `ui-badge--${variant}`, `tone-${tone}`, className)} {...rest} />;
}
