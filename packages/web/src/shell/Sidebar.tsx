import type { HubSnapshot, WorkSnapshot } from "@b-net/core";
import { Badge } from "../components/Badge.tsx";
import { DotIcon } from "../components/icons.tsx";
import { routes, type RouteDef } from "../routes.tsx";
import { deriveNavBadges } from "./badges.ts";
import { SourceHealthList } from "./SourceHealthList.tsx";

export interface SidebarProps {
  activeId: RouteDef["id"];
  snapshot: HubSnapshot | null;
  work?: WorkSnapshot | null;
  /** Mobile drawer state (ignored on wider screens). */
  open: boolean;
  onNavigate: () => void;
}

const GROUPS: { id: RouteDef["group"]; label: string }[] = [
  { id: "work", label: "Trabajo" },
  { id: "fleet", label: "Flota" },
];

/**
 * Brand, primary nav in two sections (daily work, then the fleet) with attention badges, keyboard
 * shortcut hint and source health. Collapses to an icon rail / drawer via CSS.
 */
export function Sidebar({ activeId, snapshot, work = null, open, onNavigate }: SidebarProps) {
  const badges = deriveNavBadges(snapshot, work);
  return (
    <aside id="sh-sidebar" className="sh-sidebar" data-open={open} aria-label="Barra lateral">
      <a className="sh-brand" href={routes[0]!.path} onClick={onNavigate}>
        <span className="sh-brand__mark" aria-hidden="true" />
        <span className="sh-brand__text sh-collapse">
          <span className="sh-brand__name">b-net</span>
          <span className="sh-brand__tag">centro de trabajo</span>
        </span>
      </a>

      <nav className="sh-nav" aria-label="Principal">
        {GROUPS.map((g) => (
          <div className="sh-nav__group" key={g.id}>
            <h2 className="sh-nav__heading ui-label sh-collapse" id={`sh-nav-${g.id}`}>{g.label}</h2>
            <ul aria-labelledby={`sh-nav-${g.id}`}>
              {routes.filter((r) => r.group === g.id).map((r) => {
                const Icon = r.icon ?? DotIcon;
                const active = r.id === activeId;
                const badge = badges[r.id];
                return (
                  <li key={r.id}>
                    <a
                      className="sh-nav__link"
                      href={r.path}
                      aria-current={active ? "page" : undefined}
                      aria-keyshortcuts={r.shortcut ? `g ${r.shortcut}` : undefined}
                      title={r.shortcut ? `${r.label} (g ${r.shortcut})` : r.label}
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
                      {r.shortcut && !badge && (
                        <kbd className="sh-nav__kbd sh-collapse" aria-hidden="true">g {r.shortcut}</kbd>
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <SourceHealthList sources={snapshot?.sources ?? []} />

      {snapshot && <p className="sh-version num sh-collapse">hub {snapshot.hubVersion}</p>}
    </aside>
  );
}
