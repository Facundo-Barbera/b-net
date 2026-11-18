/** View-local derivations over the snapshot: status/tone mapping, summary, link labels, thread grouping. */
import type { MachineStatus, MachineView, SourceHealth, T3ThreadView, ThreadState } from "@b-net/core";
import type { Tone } from "../../components/index.ts";
import { missingMetricsReason } from "../../data/sources.ts";
import { formatMs } from "../../lib/format.ts";
import { spanEs } from "../../lib/spanish.ts";

export const STATUS_LABEL: Record<MachineStatus, string> = {
  online: "Online",
  degraded: "Degraded",
  offline: "Offline",
  paused: "Paused",
  unknown: "Unknown",
};
export const ROLE_LABEL: Record<MachineView["role"], string> = {
  hub: "Hub",
  vps: "VPS",
  workstation: "Estación",
  laptop: "Laptop",
  server: "Servidor",
};
export const OS_LABEL: Record<MachineView["os"], string> = {
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
  wsl: "Windows · WSL",
};

export type Counts = MachineView["threadCounts"];
/** "Activos" (awake) sandboxes = threads with a live provider session (active + waiting + idle). */
export const awake = (c: Counts) => c.active + c.waiting + c.idle;

/* ------------------------------ topology links ----------------------------- */

export type LinkKind = "direct" | "derp" | "peer-relay" | "offline" | "unknown";

export function linkKind(m: MachineView): LinkKind {
  if (m.status === "offline" || !m.tailscale.online) return "offline";
  switch (m.tailscale.path) {
    case "direct": return "direct";
    case "derp": return "derp";
    case "peer-relay": return "peer-relay";
    default: return "unknown";
  }
}

/** Label drawn on the topology link (and read by assistive tech through the node name). Always names the path in words. */
export function linkLabel(m: MachineView): string {
  const kind = linkKind(m);
  const lat = m.tailscale.latencyMs;
  switch (kind) {
    case "offline": return "offline";
    case "direct": return `${formatMs(lat)} · directo`;
    case "derp": return `${formatMs(lat)} · DERP ${m.tailscale.relay ?? "?"}`;
    case "peer-relay": return `${formatMs(lat)} · peer relay`;
    default: return lat === null ? "ruta desconocida" : `${formatMs(lat)} · ruta desconocida`;
  }
}

/* --------------------------------- summary -------------------------------- */

export interface Summary {
  total: number;
  /** reachable machines: online + degraded */
  online: number;
  degraded: number;
  offline: number;
  paused: number;
  unknown: number;
  /** Machines with no metrics source configured (metricsSource "none"), whatever their status. */
  noMetrics: number;
  awake: number;
  dormant: number;
  worst: { machine: MachineView; latencyMs: number } | null;
}

export function summarize(machines: MachineView[], hubId: string): Summary {
  const by = (s: MachineStatus) => machines.filter((m) => m.status === s).length;
  let worst: Summary["worst"] = null;
  for (const m of machines) {
    const l = m.tailscale.latencyMs;
    if (m.id === hubId || m.tailscale.path === "self" || l === null) continue;
    if (!worst || l > worst.latencyMs) worst = { machine: m, latencyMs: l };
  }
  return {
    total: machines.length,
    online: by("online") + by("degraded"),
    degraded: by("degraded"),
    offline: by("offline"),
    paused: by("paused"),
    unknown: by("unknown"),
    noMetrics: machines.filter((m) => m.metricsSource === "none").length,
    awake: machines.reduce((a, m) => a + awake(m.threadCounts), 0),
    dormant: machines.reduce((a, m) => a + m.threadCounts.dormant, 0),
    worst,
  };
}

/* ---------------------------- metrics availability --------------------------- */

export interface MetricsNote {
  tone: Tone;
  text: string;
  /** No metrics source at all: the card offers how to connect one. */
  noSource: boolean;
}

/**
 * Why a machine has no (fresh) numbers. Explicit so every empty state reads differently: offline,
 * paused in Beszel, no metrics source (and which one is missing), or a source that has not reported yet.
 */
export function metricsNote(m: MachineView, sources: readonly SourceHealth[]): MetricsNote | null {
  const noSource = m.metricsSource === "none";
  if (m.status === "offline") return { tone: "danger", noSource, text: m.metrics ? "Offline: últimos valores conocidos" : "Offline: sin métricas" };
  if (m.status === "paused") return { tone: "idle", noSource, text: m.metrics ? "Pausada en Beszel: últimos valores conocidos" : "Pausada en Beszel: sin métricas" };
  if (noSource) return { tone: "neutral", noSource, text: `Sin fuente de métricas: ${missingMetricsReason(m, sources)}` };
  if (!m.metrics) return { tone: "warn", noSource, text: "Métricas aún sin reportar" };
  return null;
}

/** Age in ms of an ISO timestamp (null when unknown). */
export function ageMs(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : nowMs - t;
}

/** Relative time for inline text ("hace 5m"), "nunca" when the instant is unknown. */
export const ago = (iso: string | null | undefined, nowMs: number): string => (iso ? spanEs(iso, nowMs) : "nunca");

/* --------------------------------- threads -------------------------------- */

export const ACTIVE_STATES = ["active", "waiting", "idle", "dormant"] as const;
export const GROUP_TITLE: Record<ThreadState, string> = {
  active: "Active",
  waiting: "Waiting · te necesita",
  idle: "Idle",
  dormant: "Dormant",
  archived: "Archived",
};

export interface ThreadNode {
  thread: T3ThreadView;
  children: ThreadNode[];
  /** Set when the parent exists but lives in another state group (so it cannot nest here). */
  parentElsewhere: T3ThreadView | null;
}
export interface ThreadGroup {
  state: ThreadState;
  count: number;
  nodes: ThreadNode[];
}

const byUpdatedDesc = (a: T3ThreadView, b: T3ThreadView) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

/**
 * Group a machine's threads by state (active, waiting, idle, dormant; archived only on request).
 * Child threads nest under their parent when both are in the same group.
 */
export function groupThreads(all: T3ThreadView[], showArchived: boolean): ThreadGroup[] {
  const states: ThreadState[] = showArchived ? [...ACTIVE_STATES, "archived"] : [...ACTIVE_STATES];
  const byId = new Map(all.map((t) => [t.id, t]));
  const groups: ThreadGroup[] = [];
  for (const state of states) {
    const inGroup = all.filter((t) => t.state === state).sort(byUpdatedDesc);
    if (inGroup.length === 0) continue;
    const ids = new Set(inGroup.map((t) => t.id));
    const nodes = new Map<string, ThreadNode>(
      inGroup.map((t) => {
        const p = t.parentThreadId ? byId.get(t.parentThreadId) ?? null : null;
        return [t.id, { thread: t, children: [], parentElsewhere: p && !ids.has(p.id) ? p : null }];
      }),
    );
    const roots: ThreadNode[] = [];
    for (const t of inGroup) {
      const node = nodes.get(t.id)!;
      const parent = t.parentThreadId && t.parentThreadId !== t.id ? nodes.get(t.parentThreadId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    // Defensive: a parent cycle would leave nodes unreachable; surface them as roots.
    const seen = new Set<string>();
    const walk = (n: ThreadNode) => { seen.add(n.thread.id); n.children.forEach(walk); };
    roots.forEach(walk);
    for (const t of inGroup) if (!seen.has(t.id)) { const n = nodes.get(t.id)!; n.children = []; roots.push(n); walk(n); }
    groups.push({ state, count: inGroup.length, nodes: roots });
  }
  return groups;
}
