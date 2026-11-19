import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { HubSnapshot, WorkSnapshot } from "@b-net/core";
import type { DataMode } from "../data/useSnapshot.ts";
import { useTheme } from "../lib/theme.ts";
import { routes, type RouteDef } from "../routes.tsx";
import { CommandPalette } from "./CommandPalette.tsx";
import { buildPaletteEntries } from "./palette.ts";
import { Sidebar } from "./Sidebar.tsx";
import { Topbar } from "./Topbar.tsx";

export interface ShellProps {
  route: RouteDef;
  snapshot: HubSnapshot | null;
  /** For the sidebar's "te espera" badge. */
  work?: WorkSnapshot | null;
  mode: DataMode;
  children: ReactNode;
}

/** ⌘K on macOS, Ctrl K elsewhere: the one global shortcut that takes a modifier (useGoShortcuts ignores those). */
const isPaletteKey = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k";

/** Page frame: skip link, sidebar (rail/drawer when narrow), top bar, command palette and the main landmark. */
export function Shell({ route, snapshot, work = null, mode, children }: ShellProps) {
  const { pref, setPref } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const closePalette = useCallback(() => setPaletteOpen(false), []);
  const entries = useMemo(() => buildPaletteEntries(routes, work), [work]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteKey(e)) return;
      e.preventDefault();
      setDrawerOpen(false);
      setPaletteOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.title = `${route.label} · b-net`;
    setDrawerOpen(false);
  }, [route.id, route.label]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  // The skip link must not touch location.hash (hash routing): focus <main> directly.
  const skip = (e: MouseEvent) => {
    e.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <div className="sh-root">
      <a className="sh-skip" href="#main-content" onClick={skip}>Saltar al contenido</a>
      <Sidebar activeId={route.id} snapshot={snapshot} work={work} open={drawerOpen} onNavigate={closeDrawer} />
      {drawerOpen && <div className="sh-backdrop" data-testid="drawer-backdrop" onClick={closeDrawer} aria-hidden="true" />}
      <div className="sh-main">
        <Topbar
          title={route.label}
          snapshot={snapshot}
          mode={mode}
          themePref={pref}
          onThemeChange={setPref}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((o) => !o)}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main id="main-content" ref={mainRef} className="sh-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} entries={entries} onClose={closePalette} />
    </div>
  );
}
