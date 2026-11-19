import type { HTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";

/** Row of joined `Stat` tiles (KPI strip). Labelled with `aria-label` it becomes a group. */
export function StatStrip({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("ui-statstrip", className)} role={rest["aria-label"] ? "group" : undefined} {...rest} />;
}
