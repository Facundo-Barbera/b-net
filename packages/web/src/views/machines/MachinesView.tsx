import type { ViewProps } from "../../routes.tsx";

/** STUB: owned by the UI child for this view. Keep the export name and props. */
export function MachinesView({ snapshot }: ViewProps) {
  return <section data-testid="view-machines"><h1>Machines</h1><p className="num">{snapshot.generatedAt}</p></section>;
}
