// Contrato compartido entre el motor (Board dentro del hub), el acceso, los eventos y la UI.
// Cambiarlo exige un PR propio: las demás ramas lo copian tal cual.

/** Versión fija de @vercel/board con la que se probó el self-hosting en el homelab. */
export const BOARD_PACKAGE_VERSION = "0.52.0";

/** Ruta donde el hub monta `team.fetch`. */
export const BOARD_BASE_PATH = "/api/board";

/** Un canal por proyecto: `<slug>/tareas`, `<slug>/avances`, `<slug>/prs`, `<slug>/eventos`. */
export const BOARD_CHANNEL_KINDS = ["tareas", "avances", "prs", "eventos"] as const;
export type BoardChannelKind = (typeof BOARD_CHANNEL_KINDS)[number];

export function boardChannel(projectSlug: string, kind: BoardChannelKind): string {
  return `${projectSlug}/${kind}`;
}

/** Labels que b-net escribe y lee. */
export const BOARD_LABELS = {
  project: "project", // project=<slug>
  pr: "pr", // pr=<owner>/<repo>#<n>
  state: "state", // state=<WorkState>
  thread: "thread", // thread=<id de hilo de T3>
  bot: "bot", // bot=<nombre del bot>
} as const;

export const WORK_STATES = ["en_espera", "en_curso", "listo", "bloqueado"] as const;
export type WorkState = (typeof WORK_STATES)[number];

/** Schema del evento clave que despierta a un bot. Se publica en `<slug>/eventos`. */
export const BNET_EVENT_SCHEMA = "bnet.event";
export const BNET_EVENT_VERSION = 1;
export const BNET_EVENT_KINDS = ["thread_done", "question", "blocked"] as const;
export type BnetEventKind = (typeof BNET_EVENT_KINDS)[number];

export interface BnetEventV1 {
  schema: typeof BNET_EVENT_SCHEMA;
  version: typeof BNET_EVENT_VERSION;
  kind: BnetEventKind;
  /** Slug del proyecto. */
  project: string;
  /** Bot dueño del proyecto, a quien se despierta. */
  bot: string;
  /** Id del hilo de T3, si aplica. */
  thread?: string;
  /** Una o dos frases en español. */
  summary: string;
  /** Link al hilo, PR o entregable. */
  link?: string;
  /** ISO 8601. */
  at: string;
}

/** Principales que entiende el `authenticate` del hub. */
export type BoardPrincipal =
  | { kind: "admin"; login: string } // Facundo, por Tailscale-User-Login vía tailscale serve
  | { kind: "bot"; bot: string; channels: string[] }; // token propio, grants por canal (prefijo `<slug>/`)

/** Lo que la UI consume del hub (`GET /api/v1/board/projects`). */
export interface BoardTaskView {
  id: string;
  title: string;
  state: WorkState;
  claimedBy?: string;
  leaseUntil?: string;
  pr?: string;
  thread?: string;
  updatedAt: string;
}

export interface BoardUpdateView {
  id: string;
  text: string;
  author: string;
  at: string;
  link?: string;
}

export interface BoardPrView {
  ref: string; // owner/repo#n
  title: string;
  url: string;
  state: "abierto" | "fusionado" | "cerrado";
  updatedAt: string;
}

export interface BoardProjectView {
  slug: string;
  name: string;
  bot?: string;
  tasks: BoardTaskView[];
  updates: BoardUpdateView[];
  prs: BoardPrView[];
  events: BnetEventV1[];
  /** Resúmenes HTML: ids de entregables ya existentes en el hub. */
  summaries: { id: string; title: string; at: string }[];
}

export interface BoardProjectsResponse {
  projects: BoardProjectView[];
  generatedAt: string;
}
