import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { HubSnapshot } from "@bixku/core";
import type { DataMode } from "../data/useSnapshot.ts";
import { useTheme } from "../lib/theme.ts";
import type { RouteDef } from "../routes.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Topbar } from "./Topbar.tsx";

export interface ShellProps {
  route: RouteDef;
  snapshot: HubSnapshot | null;
  mode: DataMode;
  children: ReactNode;
}

/** Page frame: skip link, sidebar (rail/drawer when narrow), top bar and the main landmark. */
export function Shell({ route, snapshot, mode, children }: ShellProps) {
  const { pref, setPref } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    document.title = `${route.label} · bixku hub`;
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
      <a className="sh-skip" href="#main-content" onClick={skip}>Skip to content</a>
      <Sidebar activeId={route.id} snapshot={snapshot} open={drawerOpen} onNavigate={closeDrawer} />
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
        />
        <main id="main-content" ref={mainRef} className="sh-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
