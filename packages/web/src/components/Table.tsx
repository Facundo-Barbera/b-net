import type { TableHTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Tighter cell padding (nested tables in cards). */
  dense?: boolean;
  /** Class for the scroll wrapper. */
  wrapClassName?: string;
}

/**
 * The one table style: uppercase muted header, hairline rows, hover highlight, horizontal scroll
 * inside its own wrapper (no page-level overflow at 375 px). Cell helpers: `.u-right`, `.u-nowrap`,
 * `.u-muted`, `.u-faint`, `.u-strong`, `.num`. Row headers (`<th scope="row">`) render as body text.
 */
export function Table({ dense, className, wrapClassName, ...rest }: TableProps) {
  return (
    <div className={cx("ui-table-wrap", wrapClassName)}>
      <table className={cx("ui-table", dense && "ui-table--dense", className)} {...rest} />
    </div>
  );
}
