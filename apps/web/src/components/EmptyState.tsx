import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** Optional decorative icon (an svg element). */
  icon?: ReactNode;
  /** Optional action (button/link). */
  action?: ReactNode;
  /** ARIA role: "status" for loading, "alert" for errors, none for plain emptiness. */
  role?: "status" | "alert";
  /** Inline variant for empty sections inside a card (less padding, muted title). */
  compact?: boolean;
}

/** Centered placeholder for loading, error and "nothing here" states. */
export function EmptyState({ title, description, icon, action, compact, className, children, ...rest }: EmptyStateProps) {
  return (
    <div className={cx("ui-empty", compact && "ui-empty--compact", className)} {...rest}>
      {icon && <div className="ui-empty__icon">{icon}</div>}
      <p className="ui-empty__title">{title}</p>
      {description != null && <p className="ui-empty__desc">{description}</p>}
      {children}
      {action != null && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
