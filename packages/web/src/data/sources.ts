import type { HubSnapshot, MachineView, SourceHealth, WorkSources } from "@b-net/core";

/**
 * Which hub data sources are connected, read from `snapshot.sources`. The hub only reports health for
 * sources it has configured, so "absent from the list" means "not connected" — the case views must
 * explain (which source, how to connect it) instead of rendering empty or misleading states.
 */
export type SourceKind = SourceHealth["source"];
export type SourceState = "ok" | "failing" | "missing";

export interface SourceStatus {
  kind: SourceKind;
  state: SourceState;
  /** First failing entry, when any (for its error and last success time). */
  failing: SourceHealth | null;
}

/** Hub-wide sources every installation is expected to have; listed even when not connected. */
export const CORE_SOURCES: readonly SourceKind[] = ["tailscale", "beszel", "proxy"];

/**
 * State of one source kind. `machineId` narrows per-machine sources (agent, t3); for t3, an exporter
 * not bound to a machine (machineId null) also counts, since it may report that machine's threads.
 */
export function sourceStatus(sources: readonly SourceHealth[], kind: SourceKind, machineId?: string): SourceStatus {
  const entries = sources.filter(
    (s) => s.source === kind && (machineId === undefined || s.machineId === machineId || (kind === "t3" && s.machineId === null)),
  );
  if (entries.length === 0) return { kind, state: "missing", failing: null };
  const failing = entries.find((s) => !s.ok) ?? null;
  // A per-machine source is ok if any entry for it is ok (an unbound exporter may cover a dead agent).
  const anyOk = entries.some((s) => s.ok);
  return { kind, state: anyOk ? "ok" : "failing", failing };
}

/** Human name, what the source feeds, and how to connect it (env of the hub / machines.json). */
export const SOURCE_SETUP: Record<SourceKind, { name: string; feeds: string; connect: string }> = {
  tailscale: {
    name: "Tailscale",
    feeds: "estado online/offline, IPs y latencia",
    connect: "En el env del hub: TAILSCALE_SOURCE=localapi (el servicio debe poder leer el socket de tailscaled) o TAILSCALE_SOURCE=cli.",
  },
  beszel: {
    name: "Beszel",
    feeds: "CPU, RAM, disco e historial",
    connect: "En el env del hub: BESZEL_URL, BESZEL_EMAIL y BESZEL_PASSWORD_FILE; en machines.json, el beszelName de cada máquina.",
  },
  proxy: {
    name: "b-net-proxy",
    feeds: "cuentas, consumo, rutas y metadatos de secretos",
    connect: "Despliega b-net-proxy y define en el env del hub HUB_PROXY_URL y HUB_PROXY_TOKEN_FILE.",
  },
  agent: {
    name: "Agente b-net",
    feeds: "métricas propias de la máquina",
    connect: "Instala b-net-agent en la máquina, pon su agentUrl en machines.json y HUB_AGENT_TOKEN_FILE en el hub.",
  },
  t3: {
    name: "T3",
    feeds: "hilos de T3",
    connect: "El agente b-net de la máquina exporta los hilos (agentUrl en machines.json), o agrega su URL a T3_EXPORTERS en el env del hub.",
  },
};

/** Why a machine has no metrics source, in words, from what the snapshot can tell. */
export function missingMetricsReason(m: MachineView, sources: readonly SourceHealth[]): string {
  const beszel = sourceStatus(sources, "beszel").state;
  const agent = sourceStatus(sources, "agent", m.id).state;
  const parts = [
    beszel === "missing" ? "Beszel no está conectado al hub" : beszel === "failing" ? "Beszel no responde" : "no está en Beszel",
    agent === "missing" ? "sin agente" : agent === "failing" ? "el agente no responde" : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Count of machines without any metrics source and the state of Beszel, for the coverage notice. */
export function metricsCoverage(snapshot: HubSnapshot) {
  const without = snapshot.machines.filter((m) => m.metricsSource === "none");
  const agents = snapshot.machines.filter((m) => sourceStatus(snapshot.sources, "agent", m.id).state !== "missing").length;
  return { without, total: snapshot.machines.length, beszel: sourceStatus(snapshot.sources, "beszel").state, agents };
}

/**
 * Sources of the work home (WorkSnapshot.sources) and what connecting each one takes. threads reuses the
 * T3 text; pullRequests, git and tasks have no connector in the hub yet, and the copy says so plainly.
 */
export type WorkSourceKind = keyof WorkSources;
export const WORK_SOURCE_SETUP: Record<WorkSourceKind, { name: string; feeds: string; connect: string }> = {
  threads: { name: "T3", feeds: "hilos que te esperan, corriendo y terminados", connect: SOURCE_SETUP.t3.connect },
  projects: {
    name: "Proyectos y entregables",
    feeds: "proyectos registrados y los resúmenes HTML que publican los bots",
    connect: "En el env del hub: HUB_DATA_DIR (guarda hub.sqlite y los entregables) y HUB_BOT_TOKENS_FILE para que los bots publiquen.",
  },
  pullRequests: {
    name: "GitHub",
    feeds: "PRs abiertos y por revisar",
    connect: "El hub todavía no tiene conector de GitHub. Mientras tanto se muestran los PRs que los bots enlazan en sus entregables (prUrl).",
  },
  git: {
    name: "Git",
    feeds: "commits y ramas por proyecto",
    connect: "Todavía no hay lector de git en el agente. Las ramas que ves vienen de los hilos de T3.",
  },
  tasks: {
    name: "Tareas",
    feeds: "ideas y tareas por proyecto",
    connect: "Todavía no hay fuente de tareas conectada al hub.",
  },
};
