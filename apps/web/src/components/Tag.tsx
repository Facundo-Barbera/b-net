import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";

/** Quiet monospace chip for metadata (versions, sources, priorities). Lowercase, unlike `Badge`. */
export function Tag({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cx("ui-tag", className)} {...rest} />;
}
