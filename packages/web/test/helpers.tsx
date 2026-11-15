import type { ReactElement } from "react";
import { render, type RenderResult } from "@testing-library/react";
import { snapshotFixture } from "@bixku/core";
import { NowProvider } from "../src/components/index.ts";

/** Reference time of the canonical fixture; what the shell uses as "now" in fixture mode. */
export const NOW_MS = Date.parse(snapshotFixture.generatedAt);

/**
 * Render a view under the shell's clock. Views read "now" from `useNow()`, so this is the one way
 * tests pin time (default: the fixture's generatedAt, exactly like `<App mode="fixture" />`).
 */
export function renderAt(ui: ReactElement, now: number = NOW_MS): RenderResult {
  return render(<NowProvider value={now}>{ui}</NowProvider>);
}
