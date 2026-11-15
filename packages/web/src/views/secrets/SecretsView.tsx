import type { ViewProps } from "../../routes.tsx";

/** STUB: owned by the UI child for this view. Keep the export name and props. */
export function SecretsView({ snapshot }: ViewProps) {
  return <section data-testid="view-secrets"><h1>Secrets</h1><p className="num">{snapshot.generatedAt}</p></section>;
}
