/**
 * Operator helper (run on bixku-homelab, not in CI):
 *
 *   node packages/proxy/scripts/hash-client-key.ts <secrets.enc> <master-key-file> [--new]
 *
 * Reads the client key from stdin (or generates one with --new and prints it ONCE
 * to stdout), then prints the keyHash to put in the proxy config. The pepper is read
 * from the secret store (id "client-key-pepper"); it is never printed.
 */
import { readFileSync } from "node:fs";
import { generateClientKey, hashClientKey } from "../src/clients.ts";
import { SecretStore } from "../src/secrets.ts";

const [secretsFile, masterKeyFile, flag] = process.argv.slice(2);
if (!secretsFile || !masterKeyFile) {
  console.error("usage: hash-client-key.ts <secrets.enc> <master-key-file> [--new]");
  process.exit(2);
}
const store = SecretStore.open(secretsFile, masterKeyFile);
const pepper = store.reveal("client-key-pepper");
let key: string;
if (flag === "--new") {
  key = generateClientKey();
  console.log(`client key (shown once, give it to the client): ${key}`);
} else {
  key = readFileSync(0, "utf8").trim();
}
console.log(`keyHash: ${hashClientKey(key, pepper)}`);
