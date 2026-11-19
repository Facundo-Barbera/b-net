import { projectHref, type WorkSnapshot } from "@fhub/core";
import type { Tone } from "../components/tone.ts";
import { matchesWords } from "../lib/text.ts";
import type { RouteDef } from "../routes.tsx";
import { KIND_META } from "../views/work/kinds.ts";

/** One thing the command palette can jump to. `href` is a hash route, a t3-thread:// handoff or an https URL. */
export interface PaletteEntry {
  id: string;
  group: "Ir a" | "Te espera" | "En curso" | "Proyectos";
  label: string;
  /** Muted text after the label; also searched. */
  hint?: string;
  href: string;
  /** Status glyph (shape + colour) for work items; the hint carries the same state in words. */
  tone?: Tone;
  /** Shortcut shown on the right ("g w"). */
  shortcut?: string;
}

export const PALETTE_GROUPS: PaletteEntry["group"][] = ["Ir a", "Te espera", "En curso", "Proyectos"];

/**
 * Entries in display order: views first (always there, even before the hub answers), then what needs
 * Facundo, what runs now and every project, so the palette doubles as "find that thing" for the whole hub.
 */
export function buildPaletteEntries(routes: readonly RouteDef[], work: WorkSnapshot | null): PaletteEntry[] {
  const out: PaletteEntry[] = routes.map((r) => ({
    id: `route:${r.id}`,
    group: "Ir a",
    label: r.label,
    hint: r.group === "work" ? "Trabajo" : "Flota",
    href: r.path,
    shortcut: r.shortcut ? `g ${r.shortcut}` : undefined,
  }));
  if (!work) return out;
  for (const i of work.waiting) {
    const m = KIND_META[i.kind];
    out.push({ id: `wait:${i.id}`, group: "Te espera", label: i.title, hint: `${m.label} · ${i.project.name}`, href: i.link?.href ?? projectHref(i.project.key), tone: m.tone });
  }
  for (const i of work.running) {
    out.push({ id: `run:${i.id}`, group: "En curso", label: i.title, hint: `Corriendo · ${i.project.name}`, href: i.link?.href ?? projectHref(i.project.key), tone: "ok" });
  }
  for (const p of work.projects) {
    out.push({ id: `project:${p.ref.key}`, group: "Proyectos", label: p.ref.name, hint: p.registered ? "registrado" : "desde T3", href: projectHref(p.ref.key) });
  }
  return out;
}

/** Every word of the query must appear in the label or the hint (any order). Empty query keeps everything. */
export function filterPalette(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
  return entries.filter((e) => matchesWords(`${e.label} ${e.hint ?? ""}`, query));
}
