/**
 * Hub configuration from environment (.env.example, config/hub.example.env) + config/machines.json.
 * Secrets (passwords, tokens) are read preferably from *_FILE paths (systemd LoadCredential);
 * plain env vars are accepted as a fallback. Secret values are never logged or echoed in errors.
 */
import { z } from "zod";
import { MachineConfig } from "@b-net/core";

export type ReadTextFile = (path: string) => string;

export interface HubConfig {
  listenHost: string;
  listenPort: number;
  dataDir: string | null;
  hubMachineId: string;
  machines: MachineConfig[];
  /** Directory with the built UI (packages/web/dist/app). */
  webDir: string | null;
  /** Optional bearer token required on /api/*. */
  apiToken: string | null;
  beszel: { url: string; email: string; password: string } | null;
  tailscale: { source: "cli" | "localapi"; socket: string; binary: string };
  /** Extra T3 exporter/agent base URLs not declared as machines[].agentUrl. */
  t3Exporters: string[];
  agentToken: string | null;
  proxy: { url: string; token: string | null } | null;
  pollFastSec: number;
  pollAgentSec: number;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const ANY_HOST = new Set(["0.0.0.0", "::", "[::]", ""]);

function secret(env: Record<string, string | undefined>, name: string, read: ReadTextFile): string | null {
  const file = env[`${name}_FILE`];
  if (file) {
    try {
      const v = read(file).trim();
      return v || null;
    } catch {
      throw new ConfigError(`cannot read ${name}_FILE`);
    }
  }
  const v = env[name]?.trim();
  return v ? v : null;
}

const intIn = (v: string | undefined, def: number, min: number, max: number, name: string) => {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer in [${min}, ${max}]`);
  return n;
};

const isPlaceholder = (v: string | null) => v === null || /^__CHANGE_ME__$/.test(v);

export function parseMachines(raw: unknown): MachineConfig[] {
  const r = z.array(MachineConfig).safeParse(raw);
  if (!r.success) {
    const i = r.error.issues[0];
    throw new ConfigError(`machines.json invalid at ${i?.path.join(".") ?? "?"}: ${i?.message ?? ""}`);
  }
  const ids = new Set<string>();
  for (const m of r.data) {
    if (ids.has(m.id)) throw new ConfigError(`machines.json: duplicate id ${m.id}`);
    ids.add(m.id);
  }
  return r.data;
}

export function loadHubConfig(env: Record<string, string | undefined>, read: ReadTextFile): HubConfig {
  const listenHost = env.HUB_LISTEN_HOST?.trim() ?? "";
  if (ANY_HOST.has(listenHost)) throw new ConfigError("HUB_LISTEN_HOST must be the Tailscale IP of this machine (0.0.0.0/:: refused)");

  const machinesFile = env.HUB_MACHINES_FILE || "config/machines.json";
  let machinesRaw: unknown;
  try {
    machinesRaw = JSON.parse(read(machinesFile));
  } catch {
    throw new ConfigError(`cannot read/parse ${machinesFile}`);
  }
  const machines = parseMachines(machinesRaw);

  const hubMachineId = env.HUB_MACHINE_ID || machines.find((m) => m.role === "hub")?.id || "bixku-homelab";

  const beszelUrl = env.BESZEL_URL?.trim();
  const beszelPassword = secret(env, "BESZEL_PASSWORD", read);
  const beszel =
    beszelUrl && env.BESZEL_EMAIL && !isPlaceholder(beszelPassword)
      ? { url: beszelUrl, email: env.BESZEL_EMAIL, password: beszelPassword! }
      : null;

  const tsSource = env.TAILSCALE_SOURCE || "localapi";
  if (tsSource !== "cli" && tsSource !== "localapi") throw new ConfigError("TAILSCALE_SOURCE must be cli|localapi");

  const proxyUrl = env.HUB_PROXY_URL?.trim();
  const urlList = (env.T3_EXPORTERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const u of [...urlList, ...(proxyUrl ? [proxyUrl] : []), ...(beszelUrl ? [beszelUrl] : [])]) {
    if (!URL.canParse(u)) throw new ConfigError(`invalid URL in config: ${u.slice(0, 80)}`);
  }
  const declared = new Set(machines.map((m) => m.agentUrl?.replace(/\/+$/, "")).filter(Boolean));

  return {
    listenHost,
    listenPort: intIn(env.HUB_LISTEN_PORT, 8780, 1, 65535, "HUB_LISTEN_PORT"),
    dataDir: env.HUB_DATA_DIR || null,
    hubMachineId,
    machines,
    webDir: env.HUB_WEB_DIR || null,
    apiToken: secret(env, "HUB_API_TOKEN", read),
    beszel,
    tailscale: {
      source: tsSource,
      socket: env.TAILSCALE_SOCKET || "/var/run/tailscale/tailscaled.sock",
      binary: env.TAILSCALE_BIN || "tailscale",
    },
    t3Exporters: urlList.map((u) => u.replace(/\/+$/, "")).filter((u) => !declared.has(u)),
    agentToken: secret(env, "HUB_AGENT_TOKEN", read),
    proxy: proxyUrl ? { url: proxyUrl.replace(/\/+$/, ""), token: secret(env, "HUB_PROXY_TOKEN", read) } : null,
    pollFastSec: intIn(env.HUB_POLL_FAST_SEC, 15, 5, 3600, "HUB_POLL_FAST_SEC"),
    pollAgentSec: intIn(env.HUB_POLL_AGENT_SEC, 30, 5, 3600, "HUB_POLL_AGENT_SEC"),
  };
}
