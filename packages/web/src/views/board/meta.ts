/** How Board's states read in b-net: a word and a tone (colour + glyph shape). Never colour alone. */
import type { BnetEventKind, BoardPrView, WorkState } from "@b-net/core";
import type { Tone } from "../../components/index.ts";

export const WORK_STATE_META: Record<WorkState, { label: string; tone: Tone }> = {
  bloqueado: { label: "Bloqueada", tone: "warn" },
  en_curso: { label: "En curso", tone: "ok" },
  en_espera: { label: "En espera", tone: "idle" },
  listo: { label: "Lista", tone: "info" },
};

export const EVENT_KIND_META: Record<BnetEventKind, { label: string; tone: Tone }> = {
  question: { label: "Pregunta", tone: "warn" },
  blocked: { label: "Bloqueo", tone: "danger" },
  thread_done: { label: "Hilo terminado", tone: "info" },
};

export const PR_STATE_META: Record<BoardPrView["state"], { label: string; tone: Tone }> = {
  abierto: { label: "Abierto", tone: "ok" },
  fusionado: { label: "Fusionado", tone: "info" },
  cerrado: { label: "Cerrado", tone: "dormant" },
};

/** Open first, the order a person scans them in: blocked (needs you), running, queued. */
export const OPEN_ORDER: readonly WorkState[] = ["bloqueado", "en_curso", "en_espera"];
