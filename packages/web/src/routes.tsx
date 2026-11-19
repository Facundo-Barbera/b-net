import type { ComponentType } from "react";
import type { HubSnapshot } from "@b-net/core";
import { MachinesIcon, ProjectsIcon, ProxyIcon, SecretsIcon, SubscriptionsIcon, WorkIcon } from "./components/icons.tsx";
import type { BoardState, WorkState } from "./data/useSnapshot.ts";
import { MachinesView } from "./views/machines/MachinesView.tsx";
import { ProjectsView } from "./views/projects/ProjectsView.tsx";
import { SubscriptionsView } from "./views/subscriptions/SubscriptionsView.tsx";
import { ProxyView } from "./views/proxy/ProxyView.tsx";
import { SecretsView } from "./views/secrets/SecretsView.tsx";
import { WorkView } from "./views/work/WorkView.tsx";

/** Contract between the shell and the views: the hub snapshot and the work home (views ignore what they don't use). */
export interface ViewProps {
  snapshot: HubSnapshot;
  work: WorkState;
  /** Board read through the hub. Optional: views without it (and tests) render as before. */
  board?: BoardState;
}

/** Fleet views only read the snapshot. */
export type SnapshotViewProps = Pick<ViewProps, "snapshot">;

export interface RouteDef {
  id: "work" | "projects" | "machines" | "subscriptions" | "proxy" | "secrets";
  path: `#/${string}`;
  label: string;
  component: ComponentType<ViewProps>;
  /** Sidebar icon (inline SVG component). */
  icon?: ComponentType<{ className?: string }>;
  /** Sidebar section: daily work first, the fleet below it. */
  group: "work" | "fleet";
  /** Second key of the "g <key>" shortcut. */
  shortcut?: string;
}

/** The first route is the default (unknown or empty hash). */
export const routes: RouteDef[] = [
  { id: "work", path: "#/work", label: "Trabajo", component: WorkView, icon: WorkIcon, group: "work", shortcut: "w" },
  { id: "projects", path: "#/projects", label: "Proyectos", component: ProjectsView, icon: ProjectsIcon, group: "work", shortcut: "p" },
  { id: "machines", path: "#/machines", label: "Máquinas", component: MachinesView, icon: MachinesIcon, group: "fleet", shortcut: "m" },
  { id: "subscriptions", path: "#/subscriptions", label: "Suscripciones", component: SubscriptionsView, icon: SubscriptionsIcon, group: "fleet" },
  { id: "proxy", path: "#/proxy", label: "Proxy", component: ProxyView, icon: ProxyIcon, group: "fleet" },
  { id: "secrets", path: "#/secrets", label: "Secretos", component: SecretsView, icon: SecretsIcon, group: "fleet" },
];
