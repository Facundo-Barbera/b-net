import { z } from "zod";

/** ISO-8601 timestamp string (UTC). */
export const IsoTime = z.string().datetime({ offset: true });

/** Static registry entry: how a machine is known in each source. Lives in config/machines.json. */
export const MachineConfig = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/), // stable id, e.g. "bixku-homelab"
  name: z.string(), // display name
  role: z.enum(["hub", "vps", "workstation", "laptop", "server"]),
  os: z.enum(["linux", "macos", "windows", "wsl"]),
  /** Tailscale HostName (as in `tailscale status --json`). */
  tailscaleHost: z.string(),
  /** Name of the system in Beszel, if monitored there. */
  beszelName: z.string().optional(),
  /** Base URL of the bixku agent on this machine (Tailscale address), if installed. */
  agentUrl: z.string().url().optional(),
  /** Short description of what runs there (shown in the UI). */
  notes: z.string().optional(),
});
export type MachineConfig = z.infer<typeof MachineConfig>;

export const MachineStatus = z.enum(["online", "degraded", "offline", "paused", "unknown"]);
export type MachineStatus = z.infer<typeof MachineStatus>;

export const LinkPath = z.enum(["direct", "derp", "peer-relay", "self", "unknown"]);
export type LinkPath = z.infer<typeof LinkPath>;

export const TailscaleLink = z.object({
  ip: z.string().nullable(), // first TailscaleIPs entry (IPv4)
  online: z.boolean(),
  lastSeen: IsoTime.nullable(),
  /** Measured from the hub (bixku-homelab) to this node. null = not measured / unreachable. */
  latencyMs: z.number().nonnegative().nullable(),
  path: LinkPath,
  /** DERP region code when relayed, e.g. "mia". */
  relay: z.string().nullable(),
});
export type TailscaleLink = z.infer<typeof TailscaleLink>;

export const MachineMetrics = z.object({
  cpuPct: z.number().min(0).max(100),
  memPct: z.number().min(0).max(100),
  memUsedGb: z.number().nonnegative(),
  memTotalGb: z.number().nonnegative(),
  diskPct: z.number().min(0).max(100),
  diskUsedGb: z.number().nonnegative(),
  diskTotalGb: z.number().nonnegative(),
  load1: z.number().nonnegative().nullable(),
  netRxBps: z.number().nonnegative().nullable(),
  netTxBps: z.number().nonnegative().nullable(),
  uptimeSec: z.number().nonnegative().nullable(),
  tempC: z.number().nullable(),
});
export type MachineMetrics = z.infer<typeof MachineMetrics>;

/** Short history for sparklines; oldest first, evenly spaced. */
export const MetricHistory = z.object({
  stepSec: z.number().positive(),
  cpuPct: z.array(z.number()),
  memPct: z.array(z.number()),
});
export type MetricHistory = z.infer<typeof MetricHistory>;

export const ServiceProbe = z.object({
  name: z.string(),
  port: z.number().int().nullable(),
  status: z.enum(["up", "down", "unknown"]),
});
export type ServiceProbe = z.infer<typeof ServiceProbe>;

export const MachineView = z.object({
  id: z.string(),
  name: z.string(),
  role: MachineConfig.shape.role,
  os: MachineConfig.shape.os,
  status: MachineStatus,
  tailscale: TailscaleLink,
  metrics: MachineMetrics.nullable(),
  metricsSource: z.enum(["beszel", "agent", "none"]),
  metricsAt: IsoTime.nullable(),
  history: MetricHistory.nullable(),
  services: z.array(ServiceProbe),
  /** Counts of T3 threads on this machine by state (see threads.ts). */
  threadCounts: z.object({
    active: z.number().int(),
    waiting: z.number().int(),
    idle: z.number().int(),
    dormant: z.number().int(),
  }),
  notes: z.string().nullable(),
});
export type MachineView = z.infer<typeof MachineView>;
