import { useEffect } from "react";
import type { RouteDef } from "../routes.tsx";

/** How long after "g" the second key still counts. */
export const CHORD_MS = 1200;

/** True when the key press belongs to a text field or carries a modifier (never hijack those). */
function ignored(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return true;
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

/** "g" then a route's shortcut key navigates to it (g w trabajo, g p proyectos, g m máquinas). */
export function useGoShortcuts(routes: readonly RouteDef[]): void {
  useEffect(() => {
    let armedAt = 0;
    const onKey = (e: KeyboardEvent) => {
      if (ignored(e)) return;
      const key = e.key.toLowerCase();
      if (armedAt && e.timeStamp - armedAt <= CHORD_MS) {
        armedAt = 0;
        const target = routes.find((r) => r.shortcut === key);
        if (target) {
          e.preventDefault();
          location.hash = target.path;
        }
        return;
      }
      armedAt = key === "g" ? e.timeStamp || 1 : 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [routes]);
}
