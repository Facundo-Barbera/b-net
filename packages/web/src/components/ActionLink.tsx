import type { AnchorHTMLAttributes, ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import { ExternalIcon } from "./icons.tsx";

export interface ActionLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  /** Leading icon (decorative). */
  icon?: ReactNode;
  /** Opens in a new tab (http links) and shows the external glyph. */
  external?: boolean;
}

/** Compact bordered link for the primary action of an item ("Abrir en T3", "Ver PR"). Always visible, never hover-only. */
export function ActionLink({ href, icon, external, className, children, ...rest }: ActionLinkProps) {
  return (
    <a
      className={cx("ui-action", className)}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...rest}
    >
      {icon}
      <span>{children}</span>
      {external && <ExternalIcon className="ui-action__ext" />}
    </a>
  );
}
