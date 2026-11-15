import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Optional decorative icon (an svg element). */
  icon?: ReactNode;
  /** Optional action (button/link). */
  action?: ReactNode;
  /** ARIA role: "status" for loading, "alert" for errors, none for plain emptiness. */
  role?: "status" | "alert";
  className?: string;
}

/** Centered placeholder for loading, error and "nothing here" states. */
export function EmptyState({ title, description, icon, action, role, className }: EmptyStateProps) {
  return (
    <div className={cx("ui-empty", className)} role={role}>
      {icon && <div className="ui-empty__icon">{icon}</div>}
      <p className="ui-empty__title">{title}</p>
      {description != null && <p className="ui-empty__desc">{description}</p>}
      {action != null && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
