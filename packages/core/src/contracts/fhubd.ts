/**
 * HTTP contract hub ↔ fhubd, version 0. Types and documentation only: fhubd (the per-machine daemon, a Go
 * module in fhubd/) implements the server, so there are no zod schemas here. When the hub starts calling
 * fhubd it should parse responses at that boundary like every other source.
 *
 * Transport
 * - fhubd listens only on the machine's Tailscale address (never 0.0.0.0); the hub is the only client.
 * - Every request carries `Authorization: Bearer <token>`. One token per machine: the hub keeps the token of
 *   each machine, fhubd keeps its own. Missing or wrong token → 401 with `WWW-Authenticate: Bearer realm="fhubd"`.
 *   The token never appears in responses, logs or error messages.
 * - JSON in and out (`content-type: application/json`), times as ISO 8601 with offset, sizes in bytes.
 * - Errors: non-2xx with a `FhubdError` body.
 *
 * Services are declared in fhubd's own config file on the machine (name, command and arguments, log file,
 * allowed actions, restart and health-check policy) and fhubd runs each one as its own child process. The API
 * can list them and act on them but never adds, removes or edits one: a service the config does not name is a
 * 404, so the hub cannot start or stop arbitrary processes on the machine.
 *
 * Versioning: every path starts with /v0. A breaking change gets a new prefix; fields may be added within v0,
 * so readers must ignore fields they do not know.
 */

/** Paths, relative to the daemon's base URL (e.g. `http://100.64.0.20:<port>`). */
export const FhubdRoutes = {
  health: "/v0/health", // GET → FhubdHealth
  metrics: "/v0/metrics", // GET → FhubdMetrics
  services: "/v0/services", // GET → FhubdServices
  /** POST, empty body → FhubdServiceActionResult */
  serviceAction: (name: string, action: FhubdServiceAction) => `/v0/services/${encodeURIComponent(name)}/${action}`,
  /** GET `?tail=N` → FhubdServiceLogs */
  serviceLogs: (name: string, tail?: number) =>
    `/v0/services/${encodeURIComponent(name)}/logs${tail === undefined ? "" : `?tail=${tail}`}`,
} as const;

/** `tail` when the query omits it, and the largest value accepted (above it → 400). */
export const FHUBD_LOGS_TAIL_DEFAULT = 200;
export const FHUBD_LOGS_TAIL_MAX = 2000;

type IsoTime = string;

/**
 * Error body for every non-2xx answer.
 * 400 bad input (e.g. `tail` not an integer in [1, FHUBD_LOGS_TAIL_MAX]) · 401 no/bad token ·
 * 403 action not allowed for that service by the config · 404 unknown path or service ·
 * 409 another action on the same service is still running · 500 the service manager failed.
 */
export interface FhubdError {
  error: string;
}

/* ------------------------------------------------------------------ *
 * GET /v0/health — cheap, no probes; the hub's liveness check.
 * ------------------------------------------------------------------ */
export interface FhubdHealth {
  machineId: string;
  /** fhubd build version. */
  version: string;
  /** Contract version this daemon speaks. */
  api: "v0";
  startedAt: IsoTime;
  os: "linux" | "darwin";
}

/* ------------------------------------------------------------------ *
 * GET /v0/metrics — one sample taken when asked (fhubd keeps no history;
 * the hub does).
 * ------------------------------------------------------------------ */
export interface FhubdMetrics {
  machineId: string;
  at: IsoTime;
  cpu: {
    /** Busy share across all cores since the previous sample, 0..100. */
    usagePercent: number;
    cores: number;
    /** 1/5/15-minute load averages. */
    load: [number, number, number];
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    /** What can be handed to new processes without swapping (MemAvailable on Linux). */
    availableBytes: number;
    swapTotalBytes: number;
    swapUsedBytes: number;
  };
  /** Internal filesystems (the root one first). */
  disks: FhubdDisk[];
  /** External disks named in fhubd's config, each probed on every sample. */
  externalDisks: FhubdExternalDisk[];
}

export interface FhubdDisk {
  mountpoint: string;
  totalBytes: number;
  usedBytes: number;
}

/**
 * An external disk can be listed in the config and still be unplugged, unmounted or hung (a dead USB drive
 * blocks reads instead of failing). fhubd probes each one with a short timeout so a hung disk shows up as
 * `responsive: false` instead of stalling /v0/metrics.
 */
export interface FhubdExternalDisk {
  /** Name from the config, e.g. "backup-usb". */
  name: string;
  mountpoint: string;
  mounted: boolean;
  /** The probe (stat plus a small read under the mountpoint) finished within its timeout. */
  responsive: boolean;
  /** Null when not mounted or not responsive. */
  totalBytes: number | null;
  usedBytes: number | null;
  /** Why it is not mounted/responsive, short and without paths outside the mountpoint. */
  error: string | null;
  checkedAt: IsoTime;
}

/* ------------------------------------------------------------------ *
 * GET /v0/services — the services declared in the config, with state.
 * ------------------------------------------------------------------ */
export type FhubdServiceAction = "start" | "stop" | "restart";
export type FhubdServiceState = "running" | "stopped" | "starting" | "stopping" | "failed" | "unknown";
/**
 * How the service is driven. "fhubd" means fhubd itself supervises it as a child process, which is what the
 * current daemon reports for every service; the others are reserved for services delegated to the OS or
 * container manager. A new manager is a contract change.
 */
export type FhubdServiceManager = "fhubd" | "systemd" | "systemd-user" | "launchd" | "docker";

export interface FhubdService {
  /** Name from the config: the `{name}` in the service paths. [a-z0-9][a-z0-9._-]* */
  name: string;
  description: string | null;
  manager: FhubdServiceManager;
  state: FhubdServiceState;
  /** When it entered the current state, if the manager knows. */
  since: IsoTime | null;
  /** Actions the config allows for this service; anything else answers 403. */
  actions: FhubdServiceAction[];
  /** Whether /logs has a source for this service. */
  logs: boolean;
}

export interface FhubdServices {
  machineId: string;
  at: IsoTime;
  services: FhubdService[];
}

/* ------------------------------------------------------------------ *
 * POST /v0/services/{name}/start|stop|restart — waits for the manager to
 * answer (bounded by a timeout in fhubd), then reports the state reached.
 * ------------------------------------------------------------------ */
export interface FhubdServiceActionResult {
  name: string;
  action: FhubdServiceAction;
  /** The manager accepted and completed the action. */
  ok: boolean;
  /** State read right after the action. */
  state: FhubdServiceState;
  /** The manager's short reason when `ok` is false. */
  message: string | null;
  at: IsoTime;
}

/* ------------------------------------------------------------------ *
 * GET /v0/services/{name}/logs?tail=N — the last N lines, oldest first.
 * ------------------------------------------------------------------ */
export interface FhubdLogLine {
  /** Null when the log source has no timestamps. */
  at: IsoTime | null;
  text: string;
}

export interface FhubdServiceLogs {
  name: string;
  lines: FhubdLogLine[];
  /** The source had more lines than were returned. */
  truncated: boolean;
}
