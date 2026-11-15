import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../lib/cx.ts";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** Small uppercase header label. Also names the region for assistive tech. */
  title?: ReactNode;
  /** Muted text right after the title (e.g. a count). */
  subtitle?: ReactNode;
  /** Right-aligned header slot (badges, buttons). */
  actions?: ReactNode;
  /** Remove body padding (for tables/lists that bleed to the edges). */
  flush?: boolean;
  /** Heading level of the title (default 2; views own the page h1). */
  headingLevel?: 2 | 3 | 4;
}

/** Bordered surface with an optional header row. `Panel` is an alias. */
export function Card({ title, subtitle, actions, flush, headingLevel = 2, className, children, ...rest }: CardProps) {
  const id = useId();
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  const hasHeader = title != null || actions != null;
  return (
    <section className={cx("ui-card", className)} aria-labelledby={title != null ? id : undefined} {...rest}>
      {hasHeader && (
        <header className="ui-card__head">
          {title != null && (
            <H id={id} className="ui-card__title ui-label">
              {title}
              {subtitle != null && <span className="ui-card__sub">{subtitle}</span>}
            </H>
          )}
          {actions != null && <div className="ui-card__actions">{actions}</div>}
        </header>
      )}
      <div className={cx("ui-card__body", flush && "ui-card__body--flush")}>{children}</div>
    </section>
  );
}

export const Panel = Card;
