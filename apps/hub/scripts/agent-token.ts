/**
 * Operator helper for per-machine ingest tokens (run on the hub machine):
 *
 *   HUB_DATA_DIR=/var/lib/b-net node apps/hub/scripts/agent-token.ts issue <machine-id>
 *   ... agent-token.ts revoke <machine-id>
 *   ... agent-token.ts list
 *
 * `issue` creates or rotates the token and prints it ONCE on stdout (pipe it straight into the
 * agent's token file); only sha256(token) is written to <HUB_DATA_DIR>/hub.sqlite. The running
 * hub reads tokens per request, so a rotation takes effect without a restart.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMachines } from "../src/config.ts";
import { SqliteMetricsStore } from "../src/metrics-store.ts";

const usage = "usage: HUB_DATA_DIR=<dir> agent-token.ts issue <machine-id> | revoke <machine-id> | list";
const [cmd, machineId] = process.argv.slice(2);
const dataDir = process.env.HUB_DATA_DIR;
if (!dataDir || !cmd || (cmd !== "list" && !machineId)) {
  console.error(usage);
  process.exit(2);
}
if (machineId && !/^[a-z0-9-]+$/.test(machineId)) {
  console.error("machine id must match [a-z0-9-]+");
  process.exit(2);
}

// The hub refuses tokens for machines missing from machines.json; warn early instead of failing later.
try {
  const ids = parseMachines(JSON.parse(readFileSync(process.env.HUB_MACHINES_FILE || "config/machines.json", "utf8"))).map((m) => m.id);
  if (machineId && cmd === "issue" && !ids.includes(machineId)) console.error(`warning: ${machineId} is not in machines.json; the hub will refuse its pushes`);
} catch {
  console.error("warning: machines.json not readable; machine id not checked");
}

const store = new SqliteMetricsStore(join(dataDir, "hub.sqlite"));
try {
  if (cmd === "issue") {
    const token = store.issueToken(machineId!);
    console.error(`token for ${machineId} (shown once; only its hash is stored):`);
    console.log(token);
  } else if (cmd === "revoke") {
    console.error(store.revokeToken(machineId!) ? `revoked ${machineId}` : `no token for ${machineId}`);
  } else if (cmd === "list") {
    for (const t of store.listTokens()) console.log(`${t.machineId}\t${t.createdAt}`);
  } else {
    console.error(usage);
    process.exitCode = 2;
  }
} finally {
  store.close();
}
