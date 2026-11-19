import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fingerprint, parseMasterKey, SecretStore, type StoredMeta } from "../src/secrets.ts";
import { FakeClock, T0 } from "./helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "fhub-proxy-secrets-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const KEY = Buffer.alloc(32, 0x42); // dummy master key
const DUMMY = "dummy-secret-value-do-not-use-1234";

const meta = (id: string, over: Partial<StoredMeta> = {}): StoredMeta => ({
  id,
  kind: "api-key",
  label: `dummy ${id}`,
  provider: "anthropic",
  accountId: "anthropic-a",
  storage: "encrypted-file",
  machineId: "bixku-homelab",
  createdAt: "2026-11-01T00:00:00.000Z",
  rotatedAt: null,
  expiresAt: null,
  ...over,
});

describe("SecretStore", () => {
  it("round-trips through an encrypted file; plaintext never on disk", () => {
    const path = join(dir, "a.enc");
    const s = new SecretStore(KEY, path);
    s.put(meta("one"), DUMMY);
    s.save();
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain(DUMMY);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const again = new SecretStore(KEY, path);
    expect(again.reveal("one")).toBe(DUMMY);
    expect(again.listMeta()[0]!.fingerprint).toBe(fingerprint(DUMMY));
  });

  it("wrong master key fails to decrypt", () => {
    const path = join(dir, "b.enc");
    const s = new SecretStore(KEY, path);
    s.put(meta("one"), DUMMY);
    s.save();
    expect(() => new SecretStore(Buffer.alloc(32, 1), path).reveal("one")).toThrow();
  });

  it("tampering with metadata (AAD) or ciphertext is detected", () => {
    const path = join(dir, "c.enc");
    const s = new SecretStore(KEY, path);
    s.put(meta("one"), DUMMY);
    s.save();
    const f = JSON.parse(readFileSync(path, "utf8"));
    f.entries[0].meta.accountId = "someone-else";
    writeFileSync(path, JSON.stringify(f));
    expect(() => new SecretStore(KEY, path).reveal("one")).toThrow();
  });

  it("listMeta exposes metadata only and computes status from expiry", () => {
    const clock = new FakeClock();
    const s = new SecretStore(KEY, null, clock.now);
    s.put(meta("ok"), DUMMY);
    s.put(meta("soon", { expiresAt: new Date(T0 + 2 * 86400_000).toISOString() }), DUMMY + "2");
    s.put(meta("gone", { expiresAt: new Date(T0 - 1).toISOString() }), DUMMY + "3");
    s.reveal("ok");
    const list = s.listMeta();
    expect(Object.fromEntries(list.map((m) => [m.id, m.status]))).toEqual({ ok: "ok", soon: "expiring", gone: "expired" });
    expect(list.find((m) => m.id === "ok")!.lastUsedAt).toBe(new Date(T0).toISOString());
    expect(JSON.stringify(list)).not.toContain(DUMMY);
  });

  it("master key file encodings: raw / hex / base64; rejects others", () => {
    expect(parseMasterKey(KEY)).toEqual(KEY);
    expect(parseMasterKey(Buffer.from(KEY.toString("hex") + "\n"))).toEqual(KEY);
    expect(parseMasterKey(Buffer.from(KEY.toString("base64")))).toEqual(KEY);
    expect(() => parseMasterKey(Buffer.from("short"))).toThrow();
  });

  it("open() reads the master key from a file path", () => {
    const keyFile = join(dir, "master-key");
    writeFileSync(keyFile, KEY.toString("hex"), { mode: 0o600 });
    const s = SecretStore.open(join(dir, "d.enc"), keyFile);
    s.put(meta("x"), DUMMY);
    expect(s.reveal("x")).toBe(DUMMY);
  });
});
