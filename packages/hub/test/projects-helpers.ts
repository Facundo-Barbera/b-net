/** Fixtures for the projects/deliverables tests: temp data dir, in-memory SQLite, synthetic files. */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotFixture } from "@b-net/core";
import { hashToken, type BotToken } from "../src/bot-auth.ts";
import { DeliverableFiles } from "../src/deliverables.ts";
import { createHandler } from "../src/http.ts";
import { createProjectsApi, type ProjectsApiDeps } from "../src/projects-http.ts";
import { ProjectStore } from "../src/projects-store.ts";
import { MemoryUsageStore } from "../src/store.ts";

export const BOT_TOKEN = "placeholder-bot-token-fstack";
export const OTHER_BOT_TOKEN = "placeholder-bot-token-other";
export const READ_TOKEN = "placeholder-hub-token";
export const BOTS: BotToken[] = [
  { name: "fstack-vps", tokenSha256: hashToken(BOT_TOKEN) },
  { name: "other-bot", tokenSha256: hashToken(OTHER_BOT_TOKEN) },
];
export const NOW = "2026-11-17T10:00:00.000Z";

export async function setup(opts: { quotaBytes?: number; maxBytes?: number; apiToken?: string | null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "b-net-deliverables-"));
  const store = new ProjectStore(":memory:");
  const files = new DeliverableFiles(join(dir, "deliverables"));
  await files.init();
  const deps: ProjectsApiDeps = { store, files, quotaBytes: opts.quotaBytes ?? 100 * 1024 ** 3, clock: () => new Date(NOW) };
  if (opts.maxBytes !== undefined) deps.maxBytes = opts.maxBytes;
  const handler = createHandler({
    snapshot: () => snapshotFixture,
    store: new MemoryUsageStore(),
    apiToken: opts.apiToken ?? null,
    projects: createProjectsApi(deps),
    botTokens: BOTS,
  });
  const call = (path: string, init: RequestInit = {}) => handler(new Request(`http://hub.invalid${path}`, init));
  const auth = (token = BOT_TOKEN) => ({ authorization: `Bearer ${token}` });
  const createProject = (id = "demo", token = BOT_TOKEN) =>
    call("/api/v1/projects", { method: "POST", headers: { ...auth(token), "content-type": "application/json" }, body: JSON.stringify({ id, name: `Project ${id}` }) });
  const upload = (body: BodyInit, query: Record<string, string>, opts: { project?: string; headers?: Record<string, string>; token?: string } = {}) =>
    call(`/api/v1/projects/${opts.project ?? "demo"}/deliverables?${new URLSearchParams(query)}`, {
      method: "POST",
      headers: { ...auth(opts.token), ...opts.headers },
      body,
      duplex: "half",
    } as RequestInit);
  const tmpFiles = () => readdirSync(files.tmpDir);
  const cleanup = () => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, store, files, handler, call, auth, createProject, upload, tmpFiles, cleanup };
}

const pad = (head: number[] | string, total = 256) => {
  const h = typeof head === "string" ? [...Buffer.from(head, "latin1")] : head;
  const out = new Uint8Array(total);
  out.set(h);
  for (let i = h.length; i < total; i++) out[i] = (i * 31) & 0xff;
  return out;
};

/** Minimal byte prefixes that pass each magic-number check. */
export const SAMPLES = {
  png: pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpeg: pad([0xff, 0xd8, 0xff, 0xe0]),
  webp: pad("RIFF\x00\x01\x00\x00WEBPVP8 "),
  pdf: pad("%PDF-1.7\n"),
  mp4: pad("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00"),
  webm: pad([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84, ...Buffer.from("webm")]),
  mkv: pad([0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88, ...Buffer.from("matroska")]),
  gif: pad("GIF89a\x01\x00\x01\x00\x00\x00\x00"),
  elf: pad([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
  html: new TextEncoder().encode("<!doctype html><title>r</title><script>alert(document.cookie)</script><p>hola ñandú</p>"),
  svg: new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
  markdown: new TextEncoder().encode("# Informe\n\n- punto ✓\n"),
  text: new TextEncoder().encode("plain text\n"),
  badUtf8: new Uint8Array([0x68, 0x69, 0xc3, 0x28, 0x0a]),
};
