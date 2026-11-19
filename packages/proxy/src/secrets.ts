/**
 * Encrypted secret store (secrets.enc).
 *
 * File: JSON `{ version: 1, entries: [{ meta, iv, tag, ct }] }`. Each secret is
 * encrypted on its own with AES-256-GCM (random 96-bit IV) and the canonical
 * JSON of its metadata as AAD, so tampering with metadata (e.g. swapping ids)
 * fails decryption. Metadata is plaintext and never contains the value.
 *
 * Master key: read from a FILE (systemd-creds / LoadCredential puts it under
 * $CREDENTIALS_DIRECTORY), never from env or the repo. Accepted encodings:
 * 32 raw bytes, 64 hex chars, or base64 of 32 bytes.
 *
 * Public surface for the API is `listMeta()` -> SecretMeta[] (zod .strict()).
 * `reveal()` exists only for the upstream credential path and is never wired
 * to an HTTP route.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, chmodSync } from "node:fs";
import { SecretMeta } from "@fhub/core";
import { iso } from "./util.ts";

export type StoredMeta = Omit<SecretMeta, "fingerprint" | "status" | "lastUsedAt">;

interface Entry {
  meta: StoredMeta & { fingerprint: string };
  iv: string;
  tag: string;
  ct: string;
}

interface FileShape {
  version: 1;
  entries: Entry[];
}

export function parseMasterKey(buf: Buffer): Buffer {
  if (buf.length === 32) return buf;
  const s = buf.toString("utf8").trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, "hex");
  const b = Buffer.from(s, "base64");
  if (b.length === 32) return b;
  throw new Error("master key must be 32 bytes (raw, 64 hex chars or base64)");
}

export function readMasterKeyFile(path: string): Buffer {
  return parseMasterKey(readFileSync(path));
}

export const fingerprint = (value: string) => createHash("sha256").update(value, "utf8").digest("hex").slice(0, 8);

function aad(meta: Entry["meta"]): Buffer {
  const keys = Object.keys(meta).sort();
  return Buffer.from(JSON.stringify(meta, keys), "utf8");
}

const EXPIRING_MS = 7 * 86400_000;

export class SecretStore {
  private entries = new Map<string, Entry>();
  private lastUsed = new Map<string, number>();
  private readonly key: Buffer;
  private readonly path: string | null;
  private readonly now: () => number;

  constructor(masterKey: Buffer, path: string | null = null, now: () => number = Date.now) {
    if (masterKey.length !== 32) throw new Error("master key must be 32 bytes");
    this.key = masterKey;
    this.path = path;
    this.now = now;
    if (path && existsSync(path)) this.load(readFileSync(path, "utf8"));
  }

  static open(path: string, masterKeyFile: string, now?: () => number): SecretStore {
    return new SecretStore(readMasterKeyFile(masterKeyFile), path, now);
  }

  private load(text: string) {
    const f = JSON.parse(text) as FileShape;
    if (f.version !== 1 || !Array.isArray(f.entries)) throw new Error("unsupported secrets file");
    this.entries = new Map(f.entries.map((e) => [e.meta.id, e]));
  }

  serialize(): string {
    const f: FileShape = { version: 1, entries: [...this.entries.values()] };
    return JSON.stringify(f, null, 2);
  }

  save() {
    if (!this.path) throw new Error("secret store has no path");
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, this.serialize(), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }

  put(meta: StoredMeta, value: string) {
    if (!value) throw new Error("empty secret value");
    const full = { ...meta, fingerprint: fingerprint(value) };
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(aad(full));
    const ct = Buffer.concat([c.update(value, "utf8"), c.final()]);
    this.entries.set(meta.id, { meta: full, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") });
  }

  has(id: string) {
    return this.entries.has(id);
  }

  /** Decrypt one secret. Internal use only (upstream auth, pepper, admin token). */
  reveal(id: string): string {
    const e = this.entries.get(id);
    if (!e) throw new Error(`secret not found: ${id}`);
    const d = createDecipheriv("aes-256-gcm", this.key, Buffer.from(e.iv, "base64"));
    d.setAAD(aad(e.meta));
    d.setAuthTag(Buffer.from(e.tag, "base64"));
    const v = Buffer.concat([d.update(Buffer.from(e.ct, "base64")), d.final()]).toString("utf8");
    this.lastUsed.set(id, this.now());
    return v;
  }

  /** Metadata only, validated against the strict SecretMeta schema. */
  listMeta(): SecretMeta[] {
    const now = this.now();
    return [...this.entries.values()].map((e) => {
      const exp = e.meta.expiresAt ? Date.parse(e.meta.expiresAt) : null;
      const status: SecretMeta["status"] = exp === null ? "ok" : exp <= now ? "expired" : exp - now <= EXPIRING_MS ? "expiring" : "ok";
      const lu = this.lastUsed.get(e.meta.id);
      return SecretMeta.parse({
        id: e.meta.id,
        kind: e.meta.kind,
        label: e.meta.label,
        provider: e.meta.provider,
        accountId: e.meta.accountId,
        storage: e.meta.storage,
        machineId: e.meta.machineId,
        createdAt: e.meta.createdAt,
        rotatedAt: e.meta.rotatedAt,
        expiresAt: e.meta.expiresAt,
        lastUsedAt: lu !== undefined ? iso(lu) : null,
        fingerprint: e.meta.fingerprint,
        status,
      });
    });
  }
}
