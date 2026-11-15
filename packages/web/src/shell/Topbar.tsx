import type { HubSnapshot } from "@b-net/core";
import { Badge } from "../components/Badge.tsx";
import { MenuIcon } from "../components/icons.tsx";
import { RelativeTime } from "../components/RelativeTime.tsx";
import { StatusDot } from "../components/StatusDot.tsx";
import type { DataMode } from "../data/useSnapshot.ts";
import type { ThemePref } from "../lib/theme.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

export interface TopbarProps {
  title: string;
  snapshot: HubSnapshot | null;
  mode: DataMode;
  themePref: ThemePref;
  onThemeChange: (p: ThemePref) => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}

/** Page title, snapshot freshness, data-mode badge and theme toggle. */
export function Topbar({ title, snapshot, mode, themePref, onThemeChange, drawerOpen, onToggleDrawer }: TopbarProps) {
  return (
    <header className="sh-topbar">
      <button
        type="button"
        className="sh-topbar__menu"
        aria-label="Toggle navigation"
        aria-controls="sh-sidebar"
        aria-expanded={drawerOpen}
        onClick={onToggleDrawer}
      >
        <MenuIcon />
      </button>
      <div className="sh-topbar__title" data-testid="page-title">{title}</div>
      <div className="sh-topbar__meta">
        {snapshot && (
          <span className="sh-topbar__updated" data-testid="generated-at">
            <span className="ui-label">updated</span> <RelativeTime className="num" value={snapshot.generatedAt} />
          </span>
        )}
        <Badge tone={mode === "live" ? "ok" : "warn"} variant="outline" data-testid="data-mode" title={`Data mode: ${mode}`}>
          <StatusDot tone={mode === "live" ? "ok" : "warn"} pulse={mode === "live"} />
          {mode}
        </Badge>
        <ThemeToggle pref={themePref} onChange={onThemeChange} />
      </div>
    </header>
  );
}
