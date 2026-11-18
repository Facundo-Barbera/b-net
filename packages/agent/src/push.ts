/**
 * Push agent entry point: samples every AGENT_INTERVAL_SEC (30) and POSTs to the hub.
 * Opens no port. Run by the systemd user unit / launchd agent in ../deploy (or as the binary
 * built by deploy/install.sh). Never started by importing this module.
 */
import { readFileSync } from "node:fs";
import { ConfigError, loadPushConfig, type PushConfig } from "./config.ts";
import { createCollector, defaultCollectorDeps } from "./metrics/collector.ts";
import { createPusher } from "./pusher.ts";
import { AGENT_VERSION } from "./version.ts";

export function main(): void {
  let config: PushConfig;
  try {
    config = loadPushConfig(process.env, (p) => readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`b-net-agent: ${e instanceof ConfigError ? e.message : "invalid configuration"}`);
    process.exit(78); // EX_CONFIG: systemd/launchd should not hot-loop on a broken config
  }
  const pusher = createPusher({
    collector: createCollector(defaultCollectorDeps()),
    ingestUrl: config.ingestUrl,
    machineId: config.machineId,
    token: config.token,
    version: AGENT_VERSION,
    log: (line) => console.log(`b-net-agent: ${line}`),
  });

  const intervalMs = config.intervalSec * 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // setTimeout chain (not setInterval): a slow hub can never stack overlapping pushes.
  const tick = async () => {
    await pusher.pushOnce();
    timer = setTimeout(tick, intervalMs);
  };
  void pusher.prime().then(() => {
    timer = setTimeout(tick, intervalMs);
  });
  console.log(`b-net-agent ${AGENT_VERSION} pushing every ${config.intervalSec}s (machine ${config.machineId})`);

  const stop = () => {
    clearTimeout(timer);
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (import.meta.main ?? (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)) main();
