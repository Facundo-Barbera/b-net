/**
 * Publica en Board lo que el orquestador sabe y GitHub no sincroniza:
 *
 *   BOARD_URL=http://127.0.0.1:4100/api/board BOARD_TOKEN_FILE=<ruta> \
 *     node apps/hub/scripts/board-publish.ts event --project <slug> --bot <bot> \
 *       --kind thread_done|question|blocked --summary "Una o dos frases." [--thread <id>] [--link <url>]
 *
 *   ... board-publish.ts pr --project <slug> --ref owner/repo#12 --title "..." --url https://... \
 *       [--state abierto|fusionado|cerrado]
 *
 *   ... board-publish.ts schema     # registra bnet.event@1 una vez (necesita manage en *)
 *
 * El token se lee de BOARD_TOKEN_FILE (o BOARD_TOKEN) y nunca se imprime. Imprime el id del
 * mensaje en stdout. Los reintentos son seguros: el id de cada post sale de su contenido, así
 * que repetir el mismo evento o PR no publica dos veces.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { FHUB_EVENT_KINDS, FHUB_EVENT_SCHEMA, FHUB_EVENT_VERSION, type FhubEventKind, type FhubEventV1 } from "@fhub/core";
import { publishEvent, publishPr, registerEventSchema, type BoardClient, type PrInput } from "../src/board/publish.ts";

const usage = `usage: BOARD_URL=<url> BOARD_TOKEN_FILE=<path> board-publish.ts
  event  --project <slug> --bot <bot> --kind ${FHUB_EVENT_KINDS.join("|")} --summary <text> [--thread <id>] [--link <url>]
  pr     --project <slug> --ref <owner/repo#n> --title <text> --url <url> [--state abierto|fusionado|cerrado]
  schema`;

function fail(msg: string, code = 2): never {
  console.error(msg);
  process.exit(code);
}

function client(): BoardClient {
  const url = process.env.BOARD_URL?.trim();
  if (!url) fail(`BOARD_URL is required\n${usage}`);
  let token = process.env.BOARD_TOKEN?.trim();
  const file = process.env.BOARD_TOKEN_FILE?.trim();
  if (file) {
    try {
      token = readFileSync(file, "utf8").trim();
    } catch {
      fail("cannot read BOARD_TOKEN_FILE");
    }
  }
  if (!token) fail(`BOARD_TOKEN_FILE or BOARD_TOKEN is required\n${usage}`);
  return { url, token };
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "string" },
    bot: { type: "string" },
    kind: { type: "string" },
    summary: { type: "string" },
    thread: { type: "string" },
    link: { type: "string" },
    ref: { type: "string" },
    title: { type: "string" },
    url: { type: "string" },
    state: { type: "string", default: "abierto" },
  },
});

const need = (name: keyof typeof values): string => {
  const v = values[name];
  if (typeof v !== "string" || !v.trim()) fail(`--${name} is required\n${usage}`);
  return v.trim();
};

try {
  const [cmd] = positionals;
  if (cmd === "event") {
    const kind = need("kind");
    if (!(FHUB_EVENT_KINDS as readonly string[]).includes(kind)) fail(`--kind must be one of ${FHUB_EVENT_KINDS.join(", ")}`);
    const event: FhubEventV1 = {
      schema: FHUB_EVENT_SCHEMA,
      version: FHUB_EVENT_VERSION,
      kind: kind as FhubEventKind,
      project: need("project"),
      bot: need("bot"),
      summary: need("summary"),
      at: new Date().toISOString(),
    };
    if (values.thread?.trim()) event.thread = values.thread.trim();
    if (values.link?.trim()) event.link = values.link.trim();
    const r = await publishEvent(client(), event);
    console.error(r.created ? "created" : "already published");
    console.log(r.id);
  } else if (cmd === "pr") {
    const input: PrInput = {
      project: need("project"),
      ref: need("ref"),
      title: need("title"),
      url: need("url"),
      state: need("state") as PrInput["state"],
    };
    const r = await publishPr(client(), input);
    console.error(r.created ? "created" : "updated");
    console.log(r.id);
  } else if (cmd === "schema") {
    const r = await registerEventSchema(client());
    console.error(r.created ? `created ${FHUB_EVENT_SCHEMA}@${FHUB_EVENT_VERSION}` : `${FHUB_EVENT_SCHEMA}@${FHUB_EVENT_VERSION} is already registered`);
  } else {
    fail(usage);
  }
} catch (e) {
  // Errores de zod (entrada inválida) o de la API; ninguno lleva el token.
  fail(e instanceof Error ? e.message : String(e), 1);
}
