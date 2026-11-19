/**
 * Publicar en Board por su API HTTP (`BOARD_URL` + token): lo usa el script
 * `scripts/board-publish.ts`, que es como el orquestador publica eventos y PRs sin
 * sync de GitHub. Habla HTTP directo para no depender del paquete @vercel/board,
 * que instala la rama del motor.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  FHUB_EVENT_KINDS,
  FHUB_EVENT_SCHEMA,
  FHUB_EVENT_VERSION,
  BOARD_LABELS,
  ProjectId,
  boardChannel,
  type FhubEventV1,
  type BoardPrView,
} from "@fhub/core";
import { FhubEventV1Schema } from "./events.ts";

/**
 * Label con el estado del PR. El contrato no trae una clave para esto (`state` es el
 * WorkState de las tareas), así que va aparte; ver la nota en el PR.
 */
export const PR_STATE_LABEL = "pr.state";

export interface BoardClient {
  /** Base del board, p. ej. `http://127.0.0.1:4100/api/board`. Sin barra final. */
  url: string;
  token: string;
  fetch?: typeof fetch;
}

export class BoardApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "BoardApiError";
    this.status = status;
    this.code = code;
  }
}

async function call<T>(client: BoardClient, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const doFetch = client.fetch ?? globalThis.fetch;
  const res = await doFetch(`${client.url.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${client.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Respuesta no JSON (un proxy, un 502): se informa por el status.
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new BoardApiError(res.status, err?.code ?? null, `${method} ${path}: HTTP ${res.status}${err?.code ? ` ${err.code}` : ""}${err?.message ? `: ${err.message}` : ""}`);
  }
  return json as T;
}

const hash = (s: string, n: number) => createHash("sha256").update(s).digest("hex").slice(0, n);

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */

/** JSON Schema de `bnet.event@1`, con solo las palabras clave que Board acepta (sin `pattern`). */
export const FHUB_EVENT_JSON_SCHEMA = {
  type: "object",
  required: ["schema", "version", "kind", "project", "bot", "summary", "at"],
  additionalProperties: false,
  properties: {
    schema: { const: FHUB_EVENT_SCHEMA },
    version: { const: FHUB_EVENT_VERSION },
    kind: { enum: [...FHUB_EVENT_KINDS] },
    project: { type: "string", minLength: 1, maxLength: 63 },
    bot: { type: "string", minLength: 1, maxLength: 63 },
    thread: { type: "string", minLength: 1, maxLength: 200 },
    summary: { type: "string", minLength: 1, maxLength: 1000 },
    link: { type: "string", format: "uri", maxLength: 500 },
    at: { type: "string", format: "date-time" },
  },
} as const;

/** Registra `bnet.event@1` (necesita `manage` en `*`). Repetirlo con la misma definición no cambia nada. */
export async function registerEventSchema(client: BoardClient): Promise<{ created: boolean }> {
  const r = await call<{ created: boolean }>(client, "POST", "/schemas", {
    name: FHUB_EVENT_SCHEMA,
    version: FHUB_EVENT_VERSION,
    // Pre-rename text on purpose: it is part of the definition already registered as bnet.event@1.
    description: "Evento de b-net que despierta al bot dueño de un proyecto.",
    schema: FHUB_EVENT_JSON_SCHEMA,
  });
  return { created: r.created };
}

export interface PostBody {
  channel: string;
  text: string;
  labels: Record<string, string>;
  id: string;
}

/**
 * El mensaje de un evento: el resumen para quien lee el canal y el bloque que lee el watcher.
 * El id sale del contenido sin `at`: un reintento del script trae otro `at`, y aun así es el
 * mismo evento.
 */
export function fhubEventPost(event: FhubEventV1): PostBody {
  const ev = FhubEventV1Schema.parse(event);
  const labels: Record<string, string> = { [BOARD_LABELS.project]: ev.project, [BOARD_LABELS.bot]: ev.bot };
  if (ev.thread) labels[BOARD_LABELS.thread] = ev.thread;
  const { at: _at, ...identity } = ev;
  const fence = "```";
  return {
    channel: boardChannel(ev.project, "eventos"),
    text: `${ev.summary}\n\n${fence}json#${FHUB_EVENT_SCHEMA}@${FHUB_EVENT_VERSION}\n${JSON.stringify(ev, null, 2)}\n${fence}`,
    labels,
    id: `bnet-ev-${hash(JSON.stringify(identity), 32)}`,
  };
}

/**
 * Publica el evento. Si ya se publicó (mismo id, otro `at`), Board responde `duplicate_id`
 * y se devuelve el mensaje que ya estaba, sin volver a despertar al bot.
 */
export async function publishEvent(client: BoardClient, event: FhubEventV1): Promise<{ id: string; created: boolean }> {
  const post = fhubEventPost(event);
  try {
    const r = await call<{ message: { id: string } }>(client, "POST", "/messages", post);
    return { id: r.message.id, created: true };
  } catch (e) {
    if (!(e instanceof BoardApiError) || e.code !== "duplicate_id") throw e;
    const r = await call<{ message: { id: string } }>(client, "GET", `/posts/${encodeURIComponent(post.id)}`);
    return { id: r.message.id, created: false };
  }
}

/* ------------------------------------------------------------------ *
 * PRs
 * ------------------------------------------------------------------ */

export const PrRef = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9][0-9]*$/, "owner/repo#n");
const PrState = z.enum(["abierto", "fusionado", "cerrado"]);

export interface PrInput {
  project: string;
  ref: string;
  title: string;
  url: string;
  state: BoardPrView["state"];
}

const PrInputSchema = z.object({
  project: ProjectId,
  ref: PrRef,
  title: z.string().min(1).max(300),
  url: z.url({ protocol: /^https?$/ }).max(500),
  state: PrState,
});

/** Markdown sin saltos: el título va dentro de un link. */
const escapeLinkText = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/([\\[\]])/g, "\\$1");

export function prPost(input: PrInput): PostBody {
  const pr = PrInputSchema.parse(input);
  return {
    channel: boardChannel(pr.project, "prs"),
    text: `[${escapeLinkText(pr.title)}](${pr.url})`,
    labels: { [BOARD_LABELS.project]: pr.project, [BOARD_LABELS.pr]: pr.ref, [PR_STATE_LABEL]: pr.state },
    // Un hilo por PR y proyecto: el estado cambia por label, no con otro post.
    id: `bnet-pr-${hash(`${pr.project}\n${pr.ref}`, 32)}`,
  };
}

interface ThreadsPage {
  threads: { message: { id: string; labels?: Record<string, string> } }[];
}

/**
 * Crea el hilo del PR en `<slug>/prs`, o si ya existe le actualiza el estado.
 * Busca por label antes de postear porque el id fijo choca (`duplicate_id`) si cambió el título.
 */
export async function publishPr(client: BoardClient, input: PrInput): Promise<{ id: string; created: boolean }> {
  const post = prPost(input);
  const q = new URLSearchParams({ channel: post.channel, label: `${BOARD_LABELS.pr}=${post.labels[BOARD_LABELS.pr]}`, limit: "1" });
  const page = await call<ThreadsPage>(client, "GET", `/threads?${q}`);
  const existing = page.threads[0]?.message;
  if (existing) {
    if (existing.labels?.[PR_STATE_LABEL] !== input.state) {
      await call(client, "POST", `/messages/${encodeURIComponent(existing.id)}/labels`, { set: { [PR_STATE_LABEL]: input.state } });
    }
    return { id: existing.id, created: false };
  }
  const r = await call<{ message: { id: string } }>(client, "POST", "/messages", post);
  return { id: r.message.id, created: true };
}
