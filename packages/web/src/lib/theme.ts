import { useCallback, useEffect, useLayoutEffect, useState } from "react";

/** User preference ("system" follows the OS) and the concrete theme written to <html data-theme>. */
export type ThemePref = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "b-net.theme";
export const THEME_PREFS: readonly ThemePref[] = ["system", "dark", "light"];

const isPref = (v: unknown): v is ThemePref => v === "system" || v === "dark" || v === "light";

/** Dark is the product default; "system" (follow the OS) is opt-in. Mirrored in index.html. */
export const DEFAULT_THEME_PREF: ThemePref = "dark";

/** Stored preference; the default when nothing is stored or storage is unavailable. */
export function readThemePref(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPref(v) ? v : DEFAULT_THEME_PREF;
  } catch {
    return DEFAULT_THEME_PREF;
  }
}

/** Persist the preference; silently ignored if storage throws (private mode, blocked data). */
export function writeThemePref(pref: ThemePref): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    /* storage unavailable: the choice just won't survive a reload */
  }
}

function systemQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
  } catch {
    return null;
  }
}

/** OS preference; dark when it cannot be determined (the product default). */
export function systemTheme(): ResolvedTheme {
  return systemQuery()?.matches ? "light" : "dark";
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === "system" ? systemTheme() : pref;
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Theme state for the shell: preference, resolved theme, and a setter that persists + applies. */
export function useTheme(): { pref: ThemePref; resolved: ResolvedTheme; setPref: (p: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(readThemePref);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readThemePref()));

  useLayoutEffect(() => {
    const next = resolveTheme(pref);
    setResolved(next);
    applyTheme(next);
  }, [pref]);

  useEffect(() => {
    if (pref !== "system") return;
    const mql = systemQuery();
    if (!mql) return;
    const on = () => {
      const next = resolveTheme("system");
      setResolved(next);
      applyTheme(next);
    };
    mql.addEventListener?.("change", on);
    return () => mql.removeEventListener?.("change", on);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    writeThemePref(p);
    setPrefState(p);
  }, []);

  return { pref, resolved, setPref };
}
