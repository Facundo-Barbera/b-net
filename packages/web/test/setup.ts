import { afterEach, vi } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Cold runs with all vitest projects in parallel can exceed the 1s default of findBy*,
// and role queries over the full machines view can exceed the 5s default test timeout on a busy box.
configure({ asyncUtilTimeout: 5_000 });
vi.setConfig({ testTimeout: 20_000 });
afterEach(() => cleanup());
