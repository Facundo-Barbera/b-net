/**
 * Watchers de Board que despiertan al bot dueño de un proyecto.
 *
 * Cada watcher sigue `<slug>/eventos` y, por cada mensaje nuevo que trae un bloque
 * `bnet.event@1` válido, hace POST JSON al webhook del bot. El resultado de
 * `createBnetWatchers()` se pasa tal cual a `board({ watch })` de @vercel/board 0.52.0.
 *
 * Garantías:
 * - Idempotente entre reinicios: lo ya entregado queda en un `SentLog` (archivo JSON en el
 *   directorio de datos del hub). Si el hub muere entre el 2xx y el guardado, el webhook puede
 *   recibir el mismo envío dos veces; por eso cada POST lleva `x-bnet-delivery`, para que el
 *   receptor deduplique.
 * - `run` nunca lanza: si lanzara, Board reintentaría por su cuenta encima de nuestros
 *   reintentos, y un webhook caído no debe afectar al hub. Los reintentos son nuestros y acotados.
 */
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import {
  BNET_EVENT_KINDS,
  BNET_EVENT_SCHEMA,
  BNET_EVENT_VERSION,
  BotName,
  IsoTime,
  ProjectId,
  boardChannel,
  type BnetEventV1,
} from "@b-net/core";
import { ConfigError, type ReadTextFile } from "../config.ts";

/* ------------------------------------------------------------------ *
 * Tipos estructurales compatibles con `Watcher` / `WatcherContext` de
 * @vercel/board 0.52.0. Se declaran aquí para que este módulo no dependa
 * del paquete: el motor (otra rama) es quien lo instala y monta `board()`.
 * ------------------------------------------------------------------ */

export interface BoardBlockLike {
  schema: string;
  version: number;
  data: Record<string, unknown>;
}

export interface BoardMessageLike {
  id: string;
  channel: string;
  deleted?: boolean;
  blocks?: BoardBlockLike[];
}

export interface BoardEventLike {
  cursor: string;
  type: string;
  message?: BoardMessageLike;
}

export interface BnetWatcher {
  tail: string;
  run: (context: { event: BoardEventLike }) => Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Validación del evento
 * ------------------------------------------------------------------ */

export const BnetEventV1Schema = z.object({
  schema: z.literal(BNET_EVENT_SCHEMA),
  version: z.literal(BNET_EVENT_VERSION),
  kind: z.enum(BNET_EVENT_KINDS),
  project: ProjectId,
  bot: BotName,
  thread: z.string().min(1).max(200).optional(),
  summary: z.string().min(1).max(1000),
  link: z.url({ protocol: /^https?$/ }).max(500).optional(),
  at: IsoTime,
}) satisfies z.ZodType<BnetEventV1>;

/** El primer bloque `bnet.event@1` del mensaje que valide, o null. */
export function bnetEventFromMessage(message: BoardMessageLike): BnetEventV1 | null {
  for (const b of message.blocks ?? []) {
    if (b.schema !== BNET_EVENT_SCHEMA || b.version !== BNET_EVENT_VERSION) continue;
    const r = BnetEventV1Schema.safeParse(b.data);
    if (r.success) return r.data;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Config de webhooks: fuera del repo (archivo) o env. Nunca en el repo.
 * ------------------------------------------------------------------ */

/** Webhook de prueba local: lo que se usa mientras no haya config real. */
export const DEFAULT_TEST_WEBHOOK_URL = "http://127.0.0.1:8799/bnet-webhook";

export interface WebhookTarget {
  url: string;
  /** Firma HMAC-SHA256 del cuerpo; el secreto nunca viaja. */
  secret?: string;
}

export interface WebhookConfig {
  /** Para bots sin entrada propia. null: esos eventos no se envían. */
  default: WebhookTarget | null;
  bots: Record<string, WebhookTarget>;
}

const HttpUrl = z.url({ protocol: /^https?$/ });
const TargetFile = z
  .object({ url: HttpUrl, secret: z.string().min(1).optional(), secretFile: z.string().min(1).optional() })
  .strict()
  .refine((t) => !(t.secret && t.secretFile), "secret y secretFile son excluyentes");
const WebhooksFile = z
  .object({
    default: TargetFile.nullable().optional(),
    bots: z.record(BotName, TargetFile).default({}),
  })
  .strict();

/**
 * `BNET_WEBHOOKS_FILE` apunta a un JSON fuera del repo:
 *   { "default": { "url": "..." }, "bots": { "<bot>": { "url": "...", "secretFile": "/run/credentials/..." } } }
 * Sin archivo: `BNET_WEBHOOK_URL` (o el webhook de prueba local) y `BNET_WEBHOOK_SECRET[_FILE]`
 * para todos los bots. Los errores nunca incluyen secretos ni URLs (pueden llevar tokens).
 */
export function loadWebhookConfig(env: Record<string, string | undefined>, read: ReadTextFile): WebhookConfig {
  const file = env.BNET_WEBHOOKS_FILE?.trim();
  if (!file) {
    const url = env.BNET_WEBHOOK_URL?.trim() || DEFAULT_TEST_WEBHOOK_URL;
    if (!HttpUrl.safeParse(url).success) throw new ConfigError("BNET_WEBHOOK_URL must be an http(s) URL");
    const secret = readSecret(env, read);
    return { default: secret ? { url, secret } : { url }, bots: {} };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(read(file));
  } catch {
    throw new ConfigError("cannot read BNET_WEBHOOKS_FILE as JSON");
  }
  const r = WebhooksFile.safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ConfigError(`BNET_WEBHOOKS_FILE: ${i?.path.join(".") || "(root)"}: ${i?.message ?? "invalid"}`);
  }
  const toTarget = (t: z.infer<typeof TargetFile>, where: string): WebhookTarget => {
    let secret = t.secret;
    if (t.secretFile) {
      try {
        secret = read(t.secretFile).trim() || undefined;
      } catch {
        throw new ConfigError(`BNET_WEBHOOKS_FILE: ${where}: cannot read secretFile`);
      }
    }
    return secret ? { url: t.url, secret } : { url: t.url };
  };
  const bots: Record<string, WebhookTarget> = {};
  for (const [bot, t] of Object.entries(r.data.bots)) bots[bot] = toTarget(t, `bots.${bot}`);
  // Sin "default" en el archivo se sigue usando el webhook de prueba; `"default": null` lo apaga.
  const def = r.data.default === undefined ? { url: DEFAULT_TEST_WEBHOOK_URL } : r.data.default && toTarget(r.data.default, "default");
  return { default: def, bots };
}

function readSecret(env: Record<string, string | undefined>, read: ReadTextFile): string | undefined {
  const file = env.BNET_WEBHOOK_SECRET_FILE?.trim();
  if (file) {
    try {
      return read(file).trim() || undefined;
    } catch {
      throw new ConfigError("cannot read BNET_WEBHOOK_SECRET_FILE");
    }
  }
  return env.BNET_WEBHOOK_SECRET?.trim() || undefined;
}

/* ------------------------------------------------------------------ *
 * Registro de envíos hechos
 * ------------------------------------------------------------------ */

export interface SentLog {
  has(key: string): boolean;
  add(key: string): void;
}

export class MemorySentLog implements SentLog {
  private readonly keys = new Set<string>();
  has(key: string) {
    return this.keys.has(key);
  }
  add(key: string) {
    this.keys.add(key);
  }
}

/**
 * Las últimas `max` claves en un JSON, escrito con rename para que un corte a mitad no lo deje
 * a medias. Un archivo ilegible arranca vacío (con aviso): duplicar un aviso es mejor que no
 * arrancar el hub.
 */
export class FileSentLog implements SentLog {
  private keys: string[] | null = null;
  private set = new Set<string>();

  constructor(
    private readonly path: string,
    private readonly max = 5000,
    private readonly warn: (msg: string) => void = (m) => console.warn(m),
  ) {}

  private load(): string[] {
    if (this.keys) return this.keys;
    let keys: string[] = [];
    try {
      const raw: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (Array.isArray(raw) && raw.every((k) => typeof k === "string")) keys = raw;
      else this.warn("board events: sent log has an unexpected shape; starting empty");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") this.warn("board events: sent log unreadable; starting empty");
    }
    this.keys = keys.slice(-this.max);
    this.set = new Set(this.keys);
    return this.keys;
  }

  has(key: string) {
    this.load();
    return this.set.has(key);
  }

  add(key: string) {
    const keys = this.load();
    if (this.set.has(key)) return;
    keys.push(key);
    this.set.add(key);
    while (keys.length > this.max) this.set.delete(keys.shift()!);
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(keys));
    renameSync(tmp, this.path);
  }
}

/* ------------------------------------------------------------------ *
 * Envío con reintentos
 * ------------------------------------------------------------------ */

export interface RetryPolicy {
  attempts: number;
  baseMs: number;
  maxMs: number;
  timeoutMs: number;
}

/** Igual que los reintentos de Board en `local()`: 1 s doblando hasta 30 s, 5 intentos. */
export const DEFAULT_RETRY: RetryPolicy = { attempts: 5, baseMs: 1000, maxMs: 30_000, timeoutMs: 10_000 };

export function backoffMs(attempt: number, p: Pick<RetryPolicy, "baseMs" | "maxMs">): number {
  return Math.min(p.maxMs, p.baseMs * 2 ** (attempt - 1));
}

/** 4xx (salvo 408/425/429) es un rechazo del receptor: reintentar no lo arregla. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

export type DeliveryResult = { ok: true; attempts: number } | { ok: false; attempts: number; reason: string };

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export async function deliverWebhook(
  target: WebhookTarget,
  event: BnetEventV1,
  deliveryId: string,
  deps: { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; retry: RetryPolicy },
): Promise<DeliveryResult> {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "b-net-hub",
    "x-bnet-delivery": deliveryId,
    "x-bnet-event": event.kind,
  };
  if (target.secret) headers["x-bnet-signature"] = `sha256=${createHmac("sha256", target.secret).update(body).digest("hex")}`;

  let reason = "no attempts";
  for (let attempt = 1; attempt <= deps.retry.attempts; attempt++) {
    try {
      const res = await deps.fetch(target.url, { method: "POST", headers, body, signal: AbortSignal.timeout(deps.retry.timeoutMs) });
      // El cuerpo no se usa; se descarta para liberar la conexión.
      await res.body?.cancel().catch(() => {});
      if (res.ok) return { ok: true, attempts: attempt };
      reason = `HTTP ${res.status}`;
      if (!isRetryableStatus(res.status)) return { ok: false, attempts: attempt, reason };
    } catch (e) {
      reason = e instanceof Error && e.name ? e.name : "network error";
    }
    if (attempt < deps.retry.attempts) await deps.sleep(backoffMs(attempt, deps.retry));
  }
  return { ok: false, attempts: deps.retry.attempts, reason };
}

/* ------------------------------------------------------------------ *
 * Watchers
 * ------------------------------------------------------------------ */

export interface BnetWatchersOptions {
  /** Slugs de los proyectos a seguir: un watcher por `<slug>/eventos`. */
  projects: string[];
  webhooks: WebhookConfig;
  /** Persistente en producción (`FileSentLog` bajo HUB_DATA_DIR) para no duplicar tras un reinicio. */
  sentLog: SentLog;
  /** Bot dueño del proyecto según el hub. Si lo sabe y no coincide con `event.bot`, se descarta. */
  ownerOf?: (project: string) => string | null | undefined;
  retry?: Partial<RetryPolicy>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: Logger;
}

/** Id de watcher: Board admite minúsculas, dígitos y `-`, empezando por letra, hasta 32. */
export function watcherId(project: string): string {
  const id = `bnet-ev-${project}`;
  if (id.length <= 32) return id;
  const h = createHash("sha256").update(project).digest("hex").slice(0, 8);
  return `bnet-ev-${project.slice(0, 32 - 9 - 9).replace(/-+$/, "")}-${h}`;
}

/**
 * Clave de idempotencia: id del mensaje más un hash del evento. El hash evita que un board
 * recreado (los ids de `local()` vuelven a 1) choque con envíos viejos del mismo id.
 */
export function deliveryKey(messageId: string, event: BnetEventV1): string {
  const h = createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 16);
  return `${messageId}:${h}`;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createBnetWatchers(opts: BnetWatchersOptions): Record<string, BnetWatcher> {
  const log = opts.log ?? console;
  const retry = { ...DEFAULT_RETRY, ...opts.retry };
  const doFetch = opts.fetch ?? globalThis.fetch;
  const sleep = opts.sleep ?? realSleep;
  // Board corre en orden por hilo pero hilos en paralelo: dos entregas del mismo mensaje
  // (p. ej. un wake repetido) no deben salir a la vez.
  const inFlight = new Set<string>();

  const handle = async (project: string, event: BoardEventLike): Promise<void> => {
    // Solo mensajes nuevos: ediciones, reacciones y labels no despiertan a nadie.
    if (event.type !== "message.posted" || !event.message || event.message.deleted) return;
    const message = event.message;
    if (message.channel !== boardChannel(project, "eventos")) return;
    const ev = bnetEventFromMessage(message);
    if (!ev) return;
    if (ev.project !== project) {
      log.warn(`board events: message ${message.id} in ${message.channel} names another project; dropped`);
      return;
    }
    const owner = opts.ownerOf?.(project);
    if (owner && owner !== ev.bot) {
      log.warn(`board events: message ${message.id} targets bot ${ev.bot}, but ${project} belongs to ${owner}; dropped`);
      return;
    }
    const target = opts.webhooks.bots[ev.bot] ?? opts.webhooks.default;
    if (!target) {
      log.warn(`board events: no webhook for bot ${ev.bot}; message ${message.id} not sent`);
      return;
    }
    const key = deliveryKey(message.id, ev);
    if (opts.sentLog.has(key) || inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const r = await deliverWebhook(target, ev, key, { fetch: doFetch, sleep, retry });
      if (r.ok) {
        opts.sentLog.add(key);
        log.info(`board events: ${ev.kind} for ${ev.bot} (${project}) sent after ${r.attempts} attempt(s)`);
      } else {
        // Sin marcar como enviado: una nueva entrega del mismo mensaje lo vuelve a intentar.
        log.error(`board events: ${ev.kind} for ${ev.bot} (${project}) failed after ${r.attempts} attempt(s): ${r.reason}`);
      }
    } finally {
      inFlight.delete(key);
    }
  };

  const watchers: Record<string, BnetWatcher> = {};
  for (const project of new Set(opts.projects)) {
    if (!ProjectId.safeParse(project).success) {
      log.warn("board events: skipping invalid project slug");
      continue;
    }
    watchers[watcherId(project)] = {
      tail: boardChannel(project, "eventos"),
      run: async ({ event }) => {
        try {
          await handle(project, event);
        } catch (e) {
          log.error(`board events: unexpected error in ${project}: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    };
  }
  return watchers;
}
