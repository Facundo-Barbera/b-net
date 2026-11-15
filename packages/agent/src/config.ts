import { isIP } from "node:net";

/**
 * Agent configuration comes from the environment (set by systemd/launchd).
 * The bearer token is read from a file (AGENT_TOKEN_FILE, e.g. a systemd credential)
 * or, as a fallback for local use, from AGENT_TOKEN. It is never logged.
 */
export interface AgentConfig {
  machineId: string;
  token: string;
  listenHost: string;
  port: number;
  /** Override for the T3 database path (default: ~/.t3/userdata/statev2.sqlite). */
  t3DbPath: string | undefined;
  sampleIntervalSec: number;
  historyPoints: number;
}

export class ConfigError extends Error {}

/** Wildcard binds are refused: the agent must only listen on its Tailscale IP (architecture §6.1). */
export function isWildcardHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "0.0.0.0" || h === "::" || h === "0:0:0:0:0:0:0:0" || h === "*" || h === "";
}

function intVar(env: Record<string, string | undefined>, key: string, def: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${key} must be an integer in ${min}..${max}`);
  return n;
}

export function loadConfig(
  env: Record<string, string | undefined>,
  readFileSync: (path: string) => string,
): AgentConfig {
  const machineId = env["AGENT_MACHINE_ID"] ?? "";
  if (!/^[a-z0-9-]+$/.test(machineId)) throw new ConfigError("AGENT_MACHINE_ID must match [a-z0-9-]+");

  const listenHost = env["AGENT_LISTEN_HOST"] ?? "";
  if (isWildcardHost(listenHost)) {
    throw new ConfigError("AGENT_LISTEN_HOST is required and must be a specific address (the Tailscale IP), not a wildcard");
  }
  if (isIP(listenHost) === 0 && listenHost !== "localhost") {
    throw new ConfigError("AGENT_LISTEN_HOST must be an IP address (or localhost)");
  }

  let token = env["AGENT_TOKEN"]?.trim() ?? "";
  const file = env["AGENT_TOKEN_FILE"];
  if (file) {
    try {
      token = readFileSync(file).trim();
    } catch {
      throw new ConfigError("could not read AGENT_TOKEN_FILE");
    }
  }
  if (token.length < 16) {
    throw new ConfigError("agent token missing or too short (min 16 chars): set AGENT_TOKEN_FILE");
  }

  return {
    machineId,
    token,
    listenHost,
    port: intVar(env, "AGENT_PORT", 8781, 1, 65535),
    t3DbPath: env["AGENT_T3_DB"] || undefined,
    sampleIntervalSec: intVar(env, "AGENT_SAMPLE_SEC", 60, 5, 3600),
    historyPoints: intVar(env, "AGENT_HISTORY_POINTS", 30, 2, 720),
  };
}
