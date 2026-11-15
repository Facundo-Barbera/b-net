import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Cold runs with all vitest projects in parallel can exceed the 1s default of findBy*.
configure({ asyncUtilTimeout: 5_000 });
afterEach(() => cleanup());
