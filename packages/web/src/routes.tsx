import type { ComponentType } from "react";
import type { HubSnapshot } from "@b-net/core";
import { MachinesIcon, ProxyIcon, SecretsIcon, SubscriptionsIcon } from "./components/icons.tsx";
import { MachinesView } from "./views/machines/MachinesView.tsx";
import { SubscriptionsView } from "./views/subscriptions/SubscriptionsView.tsx";
import { ProxyView } from "./views/proxy/ProxyView.tsx";
import { SecretsView } from "./views/secrets/SecretsView.tsx";

/** Contract between the shell and the views: every view gets the snapshot and nothing else. */
export interface ViewProps {
  snapshot: HubSnapshot;
}

export interface RouteDef {
  id: "machines" | "subscriptions" | "proxy" | "secrets";
  path: `#/${string}`;
  label: string;
  component: ComponentType<ViewProps>;
  /** Sidebar icon (inline SVG component). */
  icon?: ComponentType<{ className?: string }>;
}

export const routes: RouteDef[] = [
  { id: "machines", path: "#/machines", label: "Machines", component: MachinesView, icon: MachinesIcon },
  { id: "subscriptions", path: "#/subscriptions", label: "Subscriptions", component: SubscriptionsView, icon: SubscriptionsIcon },
  { id: "proxy", path: "#/proxy", label: "Proxy", component: ProxyView, icon: ProxyIcon },
  { id: "secrets", path: "#/secrets", label: "Secrets", component: SecretsView, icon: SecretsIcon },
];
