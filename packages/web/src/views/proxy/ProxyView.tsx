import type { ViewProps } from "../../routes.tsx";

/** STUB: owned by the UI child for this view. Keep the export name and props. */
export function ProxyView({ snapshot }: ViewProps) {
  return <section data-testid="view-proxy"><h1>Proxy</h1><p className="num">{snapshot.generatedAt}</p></section>;
}
