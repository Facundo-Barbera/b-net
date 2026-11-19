import type { ReactNode } from "react";
import { Card, EmptyState, RelativeTime, StatusDot } from "../../components/index.ts";
import { SOURCE_SETUP, type SourceStatus } from "../../data/sources.ts";
import { spanEs } from "../../lib/spanish.ts";

/**
 * Whole-view placeholder for a view whose data source is not connected or not answering. Says which
 * source is missing, what it would show and how to connect it, instead of an empty page.
 */
export function SourceNotice({ status, testId, children }: { status: SourceStatus; testId?: string; children?: ReactNode }) {
  const setup = SOURCE_SETUP[status.kind];
  const missing = status.state === "missing";
  return (
    <Card>
      <EmptyState
        data-testid={testId}
        data-source-state={status.state}
        icon={<StatusDot tone={missing ? "dormant" : "danger"} className="ui-empty__glyph" />}
        title={missing ? `${setup.name} no está conectado` : `${setup.name} no responde`}
        description={missing ? `Sin esta fuente no hay ${setup.feeds}.` : `El hub no recibe ${setup.feeds}.`}
      >
        {status.failing?.error ? <code className="u-danger">{status.failing.error}</code> : null}
        {status.failing ? (
          <p className="u-muted">
            Último dato: <RelativeTime value={status.failing.lastSuccessAt} format={spanEs} fallback="nunca" />
          </p>
        ) : null}
        <p className="ui-empty__how">
          <span className="ui-label">Cómo conectarlo</span> {setup.connect}
        </p>
        {children}
      </EmptyState>
    </Card>
  );
}
