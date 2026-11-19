/**
 * Canonical projects/deliverables fixture and the WorkSnapshot derived from it plus snapshotFixture's
 * threads, through the same deriveWork() the hub runs. All data is FAKE (ids, hashes, bots).
 */
import type { Deliverable, ProjectSummary } from "../contracts/projects.ts";
import type { WorkSnapshot } from "../contracts/work.ts";
import { deriveWork, type ProjectCatalogEntry } from "../work.ts";
import { FIXTURE_NOW, snapshotFixture } from "./snapshot.ts";

const now = Date.parse(FIXTURE_NOW);
const ago = (min: number) => new Date(now - min * 60_000).toISOString();
const hex = (seed: string) => seed.repeat(64).slice(0, 64);

const project = (p: Partial<ProjectSummary> & Pick<ProjectSummary, "id" | "name">): ProjectSummary => ({
  description: "",
  grouping: { t3ProjectTitles: [], paths: [], gitRemotes: [] },
  ownerBot: null,
  createdAt: ago(60 * 24 * 14),
  deliverableCount: 0,
  totalBytes: 0,
  lastDeliverableAt: null,
  ...p,
});

const deliverable = (d: Partial<Deliverable> & Pick<Deliverable, "id" | "projectId" | "title" | "createdAt">): Deliverable => ({
  filename: "resumen.html",
  kind: "html",
  mimeType: "text/html; charset=utf-8",
  sizeBytes: 18_432,
  sha256: hex(d.id.slice(0, 1)),
  author: "fstack-vps",
  threadId: null,
  prUrl: null,
  ...d,
});

const bnet: Deliverable[] = [
  deliverable({
    id: "0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1",
    projectId: "fhub",
    title: "Resumen: pase de UI con fstack",
    createdAt: ago(40),
    threadId: "th_01",
    prUrl: "https://github.com/Facundo-Barbera/fhub/pull/1",
  }),
  deliverable({
    id: "1c8d2e3f-4051-4b62-8c73-8d94ea5fb602",
    projectId: "fhub",
    title: "Informe: API de proyectos y entregables",
    createdAt: ago(60 * 5),
    sizeBytes: 24_870,
    prUrl: "https://github.com/Facundo-Barbera/fhub/pull/2",
  }),
];
const ops: Deliverable[] = [
  deliverable({
    id: "2d9e3f40-5162-4c73-9d84-9ea5fb6c0713",
    projectId: "homelab-ops",
    title: "Plan de backups con restic",
    filename: "plan-backups.md",
    kind: "markdown",
    mimeType: "text/markdown; charset=utf-8",
    sizeBytes: 6_210,
    author: "ops-homelab",
    createdAt: ago(60 * 26),
  }),
];
const bot: Deliverable[] = [
  deliverable({
    id: "3e0f4051-6273-4d84-8e95-afb6c7d18824",
    projectId: "bixku-bot",
    title: "Diseño de comandos del bot",
    filename: "comandos.pdf",
    kind: "pdf",
    mimeType: "application/pdf",
    sizeBytes: 182_000,
    createdAt: ago(60 * 24 * 10),
  }),
];

const sum = (ds: Deliverable[]) => ({
  deliverableCount: ds.length,
  totalBytes: ds.reduce((n, d) => n + d.sizeBytes, 0),
  lastDeliverableAt: ds[0]?.createdAt ?? null,
});

export const projectsFixture: ProjectCatalogEntry[] = [
  {
    project: project({
      id: "fhub",
      name: "fhub",
      description: "Hub del homelab: trabajo, proyectos, máquinas y proxy de modelos.",
      grouping: { t3ProjectTitles: ["fhub", "bixku-hub"], paths: [], gitRemotes: ["github.com/Facundo-Barbera/fhub"] },
      ownerBot: "fstack-vps",
      ...sum(bnet),
    }),
    deliverables: bnet,
  },
  {
    project: project({ id: "homelab-ops", name: "Homelab ops", description: "Backups, ACLs y mantenimiento del homelab.", ...sum(ops) }),
    deliverables: ops,
  },
  {
    project: project({ id: "bixku-bot", name: "Bot de Telegram", description: "Comandos y despliegue del bot.", grouping: { t3ProjectTitles: ["bixku-bot"], paths: [], gitRemotes: [] }, ...sum(bot) }),
    deliverables: bot,
  },
];

export const workFixture: WorkSnapshot = deriveWork({
  now,
  threads: snapshotFixture.threads,
  sources: snapshotFixture.sources,
  catalog: projectsFixture,
});
