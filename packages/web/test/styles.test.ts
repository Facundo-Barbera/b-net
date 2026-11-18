import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
  });
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const files = cssFiles(SRC).map((path) => ({ path, name: path.slice(SRC.length + 1), css: stripComments(readFileSync(path, "utf8")) }));
const tokens = files.find((f) => f.name.endsWith("tokens.css"))!;

/** Custom properties declared inside the block(s) whose selector matches `selector`. */
function declaredIn(css: string, selector: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.test(m[1]!.trim())) continue;
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:/g)) out.add(d[1]!);
  }
  return out;
}

const dark = declaredIn(tokens.css, /^:root,\s*:root\[data-theme="dark"\]$/);
const light = declaredIn(tokens.css, /^:root\[data-theme="light"\]$/);
const shared = declaredIn(tokens.css, /^:root$/);
/** Custom properties set locally by a rule (e.g. `--tone`, `--size`, `--mv-sel-bg`); not theme tokens. */
const localProps = new Set(files.flatMap((f) => [...f.css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!)).filter((n) => !dark.has(n) && !light.has(n) && !shared.has(n)));

describe("styles: tokens only, both themes", () => {
  it("the two themes define the same color tokens", () => {
    expect([...dark].sort()).toEqual([...light].sort());
    for (const required of ["--bg", "--bg-elev", "--text", "--border", "--accent", "--ok", "--warn", "--danger", "--info", "--chart-1", "--chart-2"]) {
      expect(dark.has(required), required).toBe(true);
    }
  });

  it("every var(--x) resolves to a theme token, a shared token or a locally declared property", () => {
    for (const f of files) {
      for (const m of f.css.matchAll(/var\(\s*(--[\w-]+)/g)) {
        const name = m[1]!;
        const ok = dark.has(name) || shared.has(name) || localProps.has(name);
        expect(ok, `${f.name}: ${name} is not defined`).toBe(true);
        // A color token used in a view must exist in the light theme too.
        if (dark.has(name)) expect(light.has(name), `${f.name}: ${name} missing in light theme`).toBe(true);
      }
    }
  });

  it("uses no hardcoded colors outside tokens.css", () => {
    for (const f of files.filter((x) => x !== tokens)) {
      expect(f.css, f.name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(f.css, f.name).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/);
      expect(f.css, f.name).not.toMatch(/(?:^|[:\s,(])(?:white|black|red|green|blue|yellow|orange|gray|grey)\b(?=\s*[;,)])/m);
    }
  });

  it("font sizes come from the type scale (--fs-*), not raw pixel values", () => {
    for (const f of files.filter((x) => x !== tokens)) {
      expect(f.css, f.name).not.toMatch(/font-size:\s*[\d.]+px/);
      expect(f.css, f.name).not.toMatch(/font:\s*\d+\s+[\d.]+px/);
    }
  });

  it("view components do not set inline colors", () => {
    const tsx = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? tsx(p) : /\.tsx$/.test(n) ? [p] : [];
      });
    for (const p of tsx(SRC)) {
      const src = readFileSync(p, "utf8");
      expect(src, p).not.toMatch(/(?:fill|stroke|color|background)\s*[=:]\s*["'`]#/);
    }
  });
});
