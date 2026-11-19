import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const NowContext = createContext<number | null>(null);

/**
 * Provides the reference "now" (ms) for relative times. The shell uses the snapshot's
 * `generatedAt` in fixture mode so fixtures look live, and a ticking clock in live mode.
 */
export function NowProvider({ value, children }: { value: number; children: ReactNode }) {
  return <NowContext.Provider value={value}>{children}</NowContext.Provider>;
}

/** Wall clock that re-renders every `intervalMs` (default 30s). Used by the shell for live mode. */
export function useClock(intervalMs = 30_000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

/** Current "now" in ms: the NowProvider value when present, otherwise a self-ticking clock. */
export function useNow(intervalMs = 30_000): number {
  const ctx = useContext(NowContext);
  const own = useClock(intervalMs, ctx == null);
  return ctx ?? own;
}
