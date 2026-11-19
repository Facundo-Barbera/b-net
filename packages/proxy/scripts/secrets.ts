/**
 * Operator helper for the encrypted secret store (run on bixku-homelab only).
 *
 *   node packages/proxy/scripts/secrets.ts list <secrets.enc> <master-key-file>
 *   node packages/proxy/scripts/secrets.ts put  <secrets.enc> <master-key-file> <id> <kind> <label> [provider] [accountId]
 *
 * `put` reads the value from stdin (pipe it, never pass it as an argument so it
 * does not land in shell history). `list` prints metadata only.
 */
import { readFileSync } from "node:fs";
import { SecretMeta } from "@fhub/core";
import { SecretStore } from "../src/secrets.ts";

const [cmd, file, keyFile, id, kind, label, provider, accountId] = process.argv.slice(2);
if (!cmd || !file || !keyFile) {
  console.error("usage: secrets.ts <list|put> <secrets.enc> <master-key-file> [...]");
  process.exit(2);
}
const store = SecretStore.open(file, keyFile);
if (cmd === "list") {
  for (const m of store.listMeta()) console.log(`${m.id}\t${m.kind}\t${m.fingerprint}\t${m.status}\t${m.label}`);
} else if (cmd === "put") {
  if (!id || !kind || !label) throw new Error("put needs <id> <kind> <label>");
  const value = readFileSync(0, "utf8").trim();
  const now = new Date().toISOString();
  store.put(
    {
      id,
      kind: SecretMeta.shape.kind.parse(kind),
      label,
      provider: provider ? SecretMeta.shape.provider.parse(provider) : null,
      accountId: accountId ?? null,
      storage: "encrypted-file",
      machineId: "bixku-homelab",
      createdAt: now,
      rotatedAt: store.has(id) ? now : null,
      expiresAt: null,
    },
    value,
  );
  store.save();
  console.log(`stored ${id}`);
} else {
  console.error(`unknown command ${cmd}`);
  process.exit(2);
}
