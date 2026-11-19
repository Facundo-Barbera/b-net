/**
 * Deliverable files on the homelab disk: streaming upload with type verification, atomic
 * commit, and safe serving. Layout under <root> (= <HUB_DATA_DIR>/deliverables):
 *   .tmp/<uuid>.part             in-flight uploads (wiped on start)
 *   <projectId>/<deliverableId>  committed files, named by id only (no user input in paths)
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { DeliverableId, ProjectId, type Deliverable, type DeliverableKind } from "@fhub/core";

export const DELIVERABLE_MAX_BYTES = 1024 ** 3;

export class UploadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "UploadError";
  }
}

export const MIME_BY_KIND: Record<DeliverableKind, string> = {
  html: "text/html; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  text: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
};

const EXT_KIND: Record<string, DeliverableKind> = {
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".svg": "svg",
  ".pdf": "pdf",
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".webp": "webp",
  ".mp4": "mp4",
  ".m4v": "mp4",
  ".webm": "webm",
};

const DEFAULT_EXT: Record<DeliverableKind, string> = {
  html: ".html",
  markdown: ".md",
  text: ".txt",
  svg: ".svg",
  pdf: ".pdf",
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  mp4: ".mp4",
  webm: ".webm",
};

const BINARY_KINDS = new Set<DeliverableKind>(["pdf", "png", "jpeg", "webp", "mp4", "webm"]);
/** Enough bytes for every magic number below. */
const SNIFF_BYTES = 64;
/** Text prefix searched for the <svg> root element. */
const SVG_PROBE_CHARS = 4096;
/** ISO-BMFF major brands that are plain MP4 video (QuickTime, HEIF, AVIF and audio-only are excluded). */
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "dash", "mmp4", "MSNV"]);

const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Binary type from magic bytes, or null when the head matches none of the allowed binary formats. */
export function sniffBinary(head: Uint8Array): DeliverableKind | null {
  if (ascii(head, 0, 5) === "%PDF-") return "pdf";
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP") return "webp";
  if (ascii(head, 4, 8) === "ftyp" && MP4_BRANDS.has(ascii(head, 8, 12))) return "mp4";
  // EBML header with DocType "webm" (Matroska .mkv carries "matroska" and is rejected).
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]) && ascii(head, 4, SNIFF_BYTES).includes("webm")) return "webm";
  return null;
}

/** Kind implied by the file name's extension: undefined = no extension, null = extension not allowed. */
export function kindFromFilename(filename: string | null): DeliverableKind | null | undefined {
  if (!filename) return undefined;
  const ext = extname(filename).toLowerCase();
  if (!ext) return undefined;
  return EXT_KIND[ext] ?? null;
}

/** Last path segment, no control characters or quotes, max 200 chars; null if nothing usable remains. */
export function sanitizeFilename(raw: string | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(/[/\\]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f-\u009f"]/g, "").trim().slice(0, 200);
  return clean && clean !== "." && clean !== ".." ? clean : null;
}

export const defaultFilename = (id: string, kind: DeliverableKind) => `${id}${DEFAULT_EXT[kind]}`;

export interface Received {
  tmpPath: string;
  sizeBytes: number;
  sha256: string;
  kind: DeliverableKind;
}

export interface UploadLimits {
  maxBytes: number;
  /** Bytes free under the total quota when the upload started; the commit re-checks it atomically. */
  remainingQuota: number;
}

/**
 * Streams `body` to a temp file, hashing and verifying it on the way. Memory use is bounded by
 * one chunk plus small probes, never by the file size. On any failure the temp file is removed.
 */
export async function receiveUpload(body: ReadableStream<Uint8Array>, tmpDir: string, filename: string | null, limits: UploadLimits): Promise<Received> {
  const extKind = kindFromFilename(filename);
  if (extKind === null) throw new UploadError(415, "file type not allowed (html, md, txt, pdf, png, jpeg, webp, svg, mp4, webm)");

  const tmpPath = join(tmpDir, `${randomUUID()}.part`);
  const fh = await open(tmpPath, "wx", 0o600);
  const reader = body.getReader();
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let head = new Uint8Array(0);
  let binaryKind: DeliverableKind | null = null;
  let sniffed = false;
  let isText = true;
  let textHead = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      size += value.byteLength;
      if (size > limits.maxBytes) throw new UploadError(413, `deliverable exceeds the ${limits.maxBytes} byte limit`);
      if (size > limits.remainingQuota) throw new UploadError(507, "deliverables storage quota exceeded; delete old deliverables or raise HUB_DELIVERABLES_QUOTA_GB");

      if (!sniffed) {
        const take = value.subarray(0, SNIFF_BYTES - head.byteLength);
        const merged = new Uint8Array(head.byteLength + take.byteLength);
        merged.set(head);
        merged.set(take, head.byteLength);
        head = merged;
        if (head.byteLength >= SNIFF_BYTES) {
          binaryKind = sniffBinary(head);
          sniffed = true;
        }
      }
      // Text validation runs until the file is known to be binary; it must hold for the whole file.
      if (isText && !binaryKind) {
        if (value.includes(0)) isText = false;
        else {
          try {
            const s = decoder.decode(value, { stream: true });
            if (textHead.length < SVG_PROBE_CHARS) textHead += s.slice(0, SVG_PROBE_CHARS - textHead.length);
          } catch {
            isText = false;
          }
        }
      }
      hash.update(value);
      await fh.write(value);
    }
    if (size === 0) throw new UploadError(400, "empty body");
    if (!sniffed) binaryKind = sniffBinary(head);
    if (isText && !binaryKind) {
      try {
        decoder.decode();
      } catch {
        isText = false;
      }
    }

    const kind = decideKind(binaryKind, isText, extKind, textHead);
    // Durable before the rename in commit(), so a crash never leaves a short file under a real id.
    await fh.sync();
    await fh.close();
    return { tmpPath, sizeBytes: size, sha256: hash.digest("hex"), kind };
  } catch (e) {
    await reader.cancel().catch(() => undefined);
    await fh.close().catch(() => undefined);
    await rm(tmpPath, { force: true });
    throw e;
  }
}

function decideKind(binaryKind: DeliverableKind | null, isText: boolean, extKind: DeliverableKind | undefined, textHead: string): DeliverableKind {
  if (binaryKind) {
    if (extKind && extKind !== binaryKind) throw new UploadError(415, `content is ${binaryKind} but the file name says ${extKind}`);
    return binaryKind;
  }
  if (!isText) throw new UploadError(415, "content is not an allowed type (not UTF-8 text nor a known binary format)");
  if (extKind && BINARY_KINDS.has(extKind)) throw new UploadError(415, `content is text but the file name says ${extKind}`);
  const kind = extKind ?? "text";
  if (kind === "svg" && !/<svg[\s>]/i.test(textHead)) throw new UploadError(415, "content has no <svg> root element");
  return kind;
}

/** Owns the deliverables directory. Every path it builds comes from validated ids only. */
export class DeliverableFiles {
  readonly root: string;
  readonly tmpDir: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.tmpDir = join(this.root, ".tmp");
  }

  /** Creates the layout and drops uploads interrupted by a crash or restart. */
  async init(): Promise<void> {
    await mkdir(this.tmpDir, { recursive: true, mode: 0o700 });
    for (const f of await readdir(this.tmpDir)) if (f.endsWith(".part")) await rm(join(this.tmpDir, f), { force: true });
  }

  pathFor(projectId: string, deliverableId: string): string {
    if (!ProjectId.safeParse(projectId).success || !DeliverableId.safeParse(deliverableId).success) throw new Error("invalid deliverable path ids");
    const p = resolve(this.root, projectId, deliverableId);
    if (!p.startsWith(this.root + sep)) throw new Error("deliverable path escapes root");
    return p;
  }

  /** Same-filesystem rename: the file appears complete or not at all. */
  async commit(tmpPath: string, projectId: string, deliverableId: string): Promise<string> {
    const dest = this.pathFor(projectId, deliverableId);
    await mkdir(join(this.root, projectId), { recursive: true, mode: 0o700 });
    await rename(tmpPath, dest);
    return dest;
  }
}

/* ------------------------------------------------------------------ *
 * Serving
 * ------------------------------------------------------------------ */

/**
 * Same policy GitHub uses for raw user content: an opaque-origin sandbox with no scripts, so
 * published HTML/SVG cannot run code or read anything on the UI origin. Inline data: images
 * and media keep self-contained reports readable. frame-ancestors lets the UI embed it.
 */
export const SANDBOX_CSP =
  "sandbox; default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
/**
 * Browser PDF viewers refuse to render under a CSP sandbox. PDF scripts run inside the
 * viewer's own isolated context, not in the page origin, so only framing is restricted.
 */
export const PDF_CSP = "frame-ancestors 'self'";

/** RFC 6266 / 5987: ASCII fallback plus the exact UTF-8 name. */
export function contentDisposition(filename: string, download: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

type Range = { start: number; end: number } | "unsatisfiable" | null;

/** Single byte range only; multi-range or malformed headers fall back to the full body. */
export function parseRange(header: string | null, size: number): Range {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

export async function contentResponse(d: Deliverable, filePath: string, req: Request, download: boolean): Promise<Response> {
  const size = (await stat(filePath)).size;
  const headers: Record<string, string> = {
    "content-type": MIME_BY_KIND[d.kind],
    "content-disposition": contentDisposition(d.filename, download),
    "content-security-policy": d.kind === "pdf" ? PDF_CSP : SANDBOX_CSP,
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    // Files are immutable once committed (new upload = new id), so caching by id is safe.
    "cache-control": "private, max-age=31536000, immutable",
    etag: `"${d.sha256}"`,
    "accept-ranges": "bytes",
  };
  if (req.headers.get("if-none-match") === headers.etag) return new Response(null, { status: 304, headers });

  const range = parseRange(req.headers.get("range"), size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers["content-length"] = String(end - start + 1);
  if (range) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  const status = range ? 206 : 200;
  if (req.method === "HEAD") return new Response(null, { status, headers });
  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(stream, { status, headers });
}
