import type { HubSnapshot } from "@b-net/core";
import { Badge } from "../components/Badge.tsx";
import { DotIcon } from "../components/icons.tsx";
import { routes, type RouteDef } from "../routes.tsx";
import { deriveNavBadges } from "./badges.ts";
import { SourceHealthList } from "./SourceHealthList.tsx";

export interface SidebarProps {
  activeId: RouteDef["id"];
  snapshot: HubSnapshot | null;
  /** Mobile drawer state (ignored on wider screens). */
  open: boolean;
  onNavigate: () => void;
}

/** Brand, primary nav (with attention badges) and source health. Collapses to an icon rail / drawer via CSS. */
export function Sidebar({ activeId, snapshot, open, onNavigate }: SidebarProps) {
  const badges = deriveNavBadges(snapshot);
  return (
    <aside id="sh-sidebar" className="sh-sidebar" data-open={open} aria-label="Sidebar">
      <a className="sh-brand" href={routes[0]!.path} onClick={onNavigate}>
        <span className="sh-brand__mark" aria-hidden="true" />
        <span className="sh-brand__name sh-collapse">b-net</span>
      </a>

      <nav className="sh-nav" aria-label="Primary">
        <ul>
          {routes.map((r) => {
            const Icon = r.icon ?? DotIcon;
            const active = r.id === activeId;
            const badge = badges[r.id];
            return (
              <li key={r.id}>
                <a
                  className="sh-nav__link"
                  href={r.path}
                  aria-current={active ? "page" : undefined}
                  title={r.label}
                  onClick={onNavigate}
                >
                  <Icon className="sh-nav__icon" />
                  <span className="sh-nav__label sh-collapse">{r.label}</span>
                  {badge && (
                    <Badge tone={badge.tone} className="sh-nav__badge" data-testid={`nav-badge-${r.id}`}>
                      <span className="num">{badge.count}</span>
                      <span className="sr-only"> {badge.label}</span>
                    </Badge>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <SourceHealthList sources={snapshot?.sources ?? []} />

      {snapshot && <p className="sh-version num sh-collapse">hub {snapshot.hubVersion}</p>}
    </aside>
  );
}
