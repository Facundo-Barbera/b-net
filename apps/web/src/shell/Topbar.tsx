import type { HubSnapshot } from "@fhub/core";
import { Badge } from "../components/Badge.tsx";
import { MenuIcon, SearchIcon } from "../components/icons.tsx";
import { RelativeTime } from "../components/RelativeTime.tsx";
import { StatusDot } from "../components/StatusDot.tsx";
import type { DataMode } from "../data/useSnapshot.ts";
import type { ThemePref } from "../lib/theme.ts";
import { spanEs } from "../lib/spanish.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

export interface TopbarProps {
  title: string;
  snapshot: HubSnapshot | null;
  mode: DataMode;
  themePref: ThemePref;
  onThemeChange: (p: ThemePref) => void;
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  /** Opens the command palette (also ⌘K / Ctrl K). */
  onOpenPalette?: () => void;
}

/** Shortcut text in the platform's own notation; read once, the platform does not change mid-session. */
const PALETTE_KEYS = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K";

/** Page title, snapshot freshness, data-mode badge and theme toggle. */
const MODE_TITLE: Record<DataMode, string> = {
  live: "Datos en vivo del hub",
  fixture: "Datos de ejemplo (fixture): ?data=fixture o VITE_DATA_MODE=fixture",
};

export function Topbar({ title, snapshot, mode, themePref, onThemeChange, drawerOpen, onToggleDrawer, onOpenPalette }: TopbarProps) {
  return (
    <header className="sh-topbar">
      <button
        type="button"
        className="sh-topbar__menu"
        aria-label="Mostrar u ocultar la navegación"
        aria-controls="sh-sidebar"
        aria-expanded={drawerOpen}
        onClick={onToggleDrawer}
      >
        <MenuIcon />
      </button>
      <div className="sh-topbar__crumbs">
        <span className="sh-topbar__home" aria-hidden="true">fhub</span>
        <span className="sh-topbar__sep" aria-hidden="true">/</span>
        <span className="sh-topbar__title" data-testid="page-title">{title}</span>
      </div>
      {onOpenPalette && (
        <button
          type="button"
          className="sh-search"
          onClick={onOpenPalette}
          aria-haspopup="dialog"
          aria-keyshortcuts="Meta+K Control+K"
          data-testid="palette-trigger"
        >
          <SearchIcon className="sh-search__glass" />
          <span className="sh-search__label">Buscar o ir a…</span>
          <kbd className="sh-search__kbd" aria-hidden="true">{PALETTE_KEYS}</kbd>
        </button>
      )}
      <div className="sh-topbar__meta">
        {snapshot && (
          <span className="sh-topbar__updated" data-testid="generated-at">
            <span className="ui-label">actualizado</span> <RelativeTime className="num" value={snapshot.generatedAt} format={spanEs} />
          </span>
        )}
        <Badge tone={mode === "live" ? "ok" : "warn"} variant="outline" data-testid="data-mode" title={MODE_TITLE[mode]}>
          <StatusDot tone={mode === "live" ? "ok" : "warn"} pulse={mode === "live"} />
          {mode}
        </Badge>
        <ThemeToggle pref={themePref} onChange={onThemeChange} />
      </div>
    </header>
  );
}
