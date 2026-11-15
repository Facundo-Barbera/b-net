import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Solo `vite build` en bixku-vps. No uses `vite dev`/`preview` aquí (regla del proyecto).
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist/app", emptyOutDir: true, sourcemap: false },
});
