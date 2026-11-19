import type { InputHTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";
import { SearchIcon } from "./icons.tsx";

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> {
  /** Accessible name (the placeholder is not a label). */
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** Inline filter box with a leading glass. Filters as you type; the view owns the matching. */
export function SearchField({ label, value, onChange, className, ...rest }: SearchFieldProps) {
  return (
    <label className={cx("ui-search", className)}>
      <SearchIcon className="ui-search__icon" />
      <span className="sr-only">{label}</span>
      <input className="ui-search__input" type="search" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off" spellCheck={false} {...rest} />
    </label>
  );
}
