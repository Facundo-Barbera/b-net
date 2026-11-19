import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

/*
 * `vite build` runs anywhere. `pnpm --filter @fhub/web dev` is for a machine meant to serve it
 * (never bixku-vps, per the project rules). Dev settings come from the environment or from the
 * repo-root .env (see .env.example, "Web"):
 *   WEB_HOST            bind address (default 127.0.0.1; use the Tailscale IP to reach it from the tailnet)
 *   WEB_PORT            port (default 5173)
 *   WEB_ALLOWED_HOSTS   comma-separated Host headers vite accepts besides localhost (e.g. a MagicDNS name)
 *   WEB_HUB_URL         hub base URL that /api is proxied to (default http://127.0.0.1:8780)
 *   VITE_DATA_MODE      "fixture" to serve the canonical fixture instead of live hub data
 */
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, repoRoot, ""), ...process.env };
  const port = Number(env.WEB_PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WEB_PORT must be an integer in [1, 65535]");
  const allowedHosts = (env.WEB_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const server = {
    host: env.WEB_HOST || "127.0.0.1",
    port,
    strictPort: true,
    allowedHosts,
    // Same-origin /api in dev, exactly like production where the hub serves the built UI.
    proxy: { "/api": { target: env.WEB_HUB_URL || "http://127.0.0.1:8780", changeOrigin: true } },
  };
  return {
    plugins: [react()],
    base: "./",
    envDir: repoRoot,
    server,
    build: { outDir: "dist/app", emptyOutDir: true, sourcemap: false },
  };
});
