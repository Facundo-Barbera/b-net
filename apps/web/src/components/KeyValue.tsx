import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import type { Tone } from "./tone.ts";

/** Grid of label/value pairs (`<dl>`); children are `KV`. Two columns by default. */
export function KeyValue({ className, ...rest }: HTMLAttributes<HTMLDListElement>) {
  return <dl className={cx("ui-kv", className)} {...rest} />;
}

export interface KVProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: ReactNode;
  children: ReactNode;
  /** Colors the value. */
  tone?: Tone;
}

/** One label + mono value pair inside `KeyValue`. */
export function KV({ label, children, tone, className, ...rest }: KVProps) {
  return (
    <div className={cx("ui-kv__item", tone && `tone-${tone}`, className)} {...rest}>
      <dt className="ui-label">{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}
