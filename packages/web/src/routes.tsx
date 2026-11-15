import type { ComponentType } from "react";
import type { HubSnapshot } from "@bixku/core";
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
}

export const routes: RouteDef[] = [
  { id: "machines", path: "#/machines", label: "Machines", component: MachinesView },
  { id: "subscriptions", path: "#/subscriptions", label: "Subscriptions", component: SubscriptionsView },
  { id: "proxy", path: "#/proxy", label: "Proxy", component: ProxyView },
  { id: "secrets", path: "#/secrets", label: "Secrets", component: SecretsView },
];
