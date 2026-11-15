import type { ReactNode } from "react";

export interface PageHeaderProps {
  /** The view's single `<h1>`. */
  title: ReactNode;
  /** Muted line on the right (counts, snapshot age, what the numbers mean). */
  subtitle?: ReactNode;
  /** id for the `<h1>` so the view `<section>` can reference it with aria-labelledby. */
  titleId?: string;
}

/** Heading row shared by every view. */
export function PageHeader({ title, subtitle, titleId }: PageHeaderProps) {
  return (
    <header className="ui-pagehead">
      <h1 id={titleId}>{title}</h1>
      {subtitle != null && <span className="ui-pagehead__sub">{subtitle}</span>}
    </header>
  );
}
