import type { ViewProps } from "../../routes.tsx";

/** STUB: owned by the UI child for this view. Keep the export name and props. */
export function SubscriptionsView({ snapshot }: ViewProps) {
  return <section data-testid="view-subscriptions"><h1>Subscriptions</h1><p className="num">{snapshot.generatedAt}</p></section>;
}
