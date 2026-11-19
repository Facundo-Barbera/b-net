import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** The view's single `<h1>`. */
  title: ReactNode;
  /** Muted line on the right (counts, snapshot age, what the numbers mean). */
  subtitle?: ReactNode;
  /** id for the `<h1>` so the view `<section>` can reference it with aria-labelledby. */
  titleId?: string;
  /** Small line above the title: the section of the app ("Flota") or a greeting on the home. */
  eyebrow?: ReactNode;
  /** Right-aligned controls that act on the whole view (filters, search). */
  actions?: ReactNode;
}

/** Heading row shared by every view. */
export function PageHeader({ title, subtitle, titleId, eyebrow, actions }: PageHeaderProps) {
  return (
    <header className="ui-pagehead">
      <div className="ui-pagehead__text">
        {eyebrow != null && <p className="ui-pagehead__eyebrow">{eyebrow}</p>}
        <h1 id={titleId}>{title}</h1>
        {subtitle != null && <p className="ui-pagehead__sub">{subtitle}</p>}
      </div>
      {actions != null && <div className="ui-pagehead__actions">{actions}</div>}
    </header>
  );
}
