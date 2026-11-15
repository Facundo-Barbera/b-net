import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Sin red ni puertos en los tests: todo va contra fixtures.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/{core,proxy,hub,agent}/test/**/*.test.ts"],
          environment: "node",
          testTimeout: 10_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["packages/web/test/**/*.test.{ts,tsx}", "packages/web/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["packages/web/test/setup.ts"],
          // jsdom + React renders get slow when all projects run in parallel on the VPS.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
