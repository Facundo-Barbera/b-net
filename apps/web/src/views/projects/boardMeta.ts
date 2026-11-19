import { WORK_STATES, type FhubEventKind, type BoardPrView, type BoardProjectView, type BoardProjectsResponse, type WorkState } from "@fhub/core";
import type { Tone } from "../../components/index.ts";

/**
 * How the board's enums read in fhub: a word plus a tone, and the tone also picks the glyph shape (ToneGlyph),
 * so no state rests on colour alone. Tasks are feminine ("tarea"): Bloqueadas, Listas.
 * Queued work gets the pause glyph (idle), not the warn triangle, which in Trabajo already means "te espera";
 * on a project card the board counters sit under their own "Tareas" label so the two "en espera" never mix.
 */
export const WORK_STATE_META: Record<WorkState, { plural: string; word: (n: number) => string; tone: Tone }> = {
  bloqueado: { plural: "Bloqueadas", word: (n) => (n === 1 ? "bloqueada" : "bloqueadas"), tone: "danger" },
  en_curso: { plural: "En curso", word: () => "en curso", tone: "ok" },
  en_espera: { plural: "En espera", word: () => "en espera", tone: "idle" },
  listo: { plural: "Listas", word: (n) => (n === 1 ? "lista" : "listas"), tone: "info" },
};

/** Lanes in the order a person scans them: what is stuck first, then running, queued, finished. */
export const STATE_ORDER: readonly WorkState[] = ["bloqueado", "en_curso", "en_espera", "listo"];

export const EVENT_KIND_META: Record<FhubEventKind, { label: string; tone: Tone }> = {
  question: { label: "Pregunta", tone: "warn" },
  blocked: { label: "Bloqueo", tone: "danger" },
  thread_done: { label: "Hilo terminado", tone: "info" },
};

export const PR_STATE_META: Record<BoardPrView["state"], { label: string; tone: Tone }> = {
  abierto: { label: "Abierto", tone: "ok" },
  fusionado: { label: "Fusionado", tone: "info" },
  cerrado: { label: "Cerrado", tone: "dormant" },
};

export function countByState(p: BoardProjectView): Record<WorkState, number> {
  const out = Object.fromEntries(WORK_STATES.map((s) => [s, 0])) as Record<WorkState, number>;
  for (const t of p.tasks) out[t.state] += 1;
  return out;
}

export const findBoardProject = (board: BoardProjectsResponse | null, slug: string | null) =>
  slug ? (board?.projects.find((p) => p.slug === slug) ?? null) : null;

/** Nothing published on any of the project's channels. */
export const isBoardEmpty = (p: BoardProjectView) =>
  p.tasks.length + p.updates.length + p.prs.length + p.events.length + p.summaries.length === 0;

/** Something stuck or running on the board: counts as activity for the "Con actividad" filter. */
export function boardActivity(p: BoardProjectView | null): { blocked: number; running: number } {
  if (!p) return { blocked: 0, running: 0 };
  const c = countByState(p);
  return { blocked: c.bloqueado, running: c.en_curso };
}

/**
 * Links come from whatever bots write to the board, so only schemes the UI can open safely become hrefs:
 * http(s), T3 thread links and in-app hash routes. Anything else (javascript:, data:) renders as plain text.
 */
export function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("#/")) return url;
  return /^(https?:\/\/|t3-thread:\/\/)/i.test(url) ? url : null;
}

/** GitHub URL of an `owner/repo#n` label value, or null when it does not have that exact shape. */
export function prRefUrl(ref: string): string | null {
  const m = /^([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})#([1-9][0-9]{0,8})$/.exec(ref);
  return m ? `https://github.com/${m[1]}/pull/${m[2]}` : null;
}

/** Newest first, without mutating the response (it is shared by every view through the poller). */
export const newestFirst = <T>(items: readonly T[], at: (x: T) => string): T[] =>
  [...items].sort((a, b) => Date.parse(at(b)) - Date.parse(at(a)));

/** "reserva vence en 9m", or "reserva vencida" once the lease has passed (the task may be reclaimed). */
export function leaseText(until: string, now: number, span: (v: string, now: number) => string): string {
  return Date.parse(until) > now ? `reserva vence ${span(until, now)}` : "reserva vencida";
}
