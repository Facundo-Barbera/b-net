import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Sin red ni puertos en los tests: todo va contra fixtures.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["packages/{core,proxy,agent}/test/**/*.test.ts", "apps/hub/test/**/*.test.ts"],
          environment: "node",
          testTimeout: 10_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: "web",
          include: ["apps/web/test/**/*.test.{ts,tsx}", "apps/web/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["apps/web/test/setup.ts"],
          // jsdom + React renders get slow when all projects run in parallel on the VPS.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
