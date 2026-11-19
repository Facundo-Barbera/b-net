import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import type { Tone } from "./tone.ts";

export interface CalloutProps extends HTMLAttributes<HTMLDivElement> {
  /** Accent color of the bar and tint (default neutral). */
  tone?: Tone;
  /** Optional leading icon. */
  icon?: ReactNode;
}

/** Inline notice: tinted box with a tone bar. Use role="alert"/"status"/"note" as appropriate. */
export function Callout({ tone = "neutral", icon, className, children, ...rest }: CalloutProps) {
  return (
    <div className={cx("ui-callout", `tone-${tone}`, className)} {...rest}>
      {icon && <span className="ui-callout__icon">{icon}</span>}
      <div className="ui-callout__body">{children}</div>
    </div>
  );
}
