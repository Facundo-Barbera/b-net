import type { ApiFormat, ClientKeyView, ProxyStatus, UsageRecord } from "@bixku/core";
import { Badge, Card, EmptyState, KV, KeyValue, PageHeader, RelativeTime, Stat, StatStrip, StatusDot, Table, Tag, type Tone } from "../../components/index.ts";
import { formatInt, formatMs, formatPercent, formatSpan, formatTokens, formatUsd } from "../../lib/format.ts";
import type { ViewProps } from "../../routes.tsx";
import { spanEs, spanEsSeconds } from "../subscriptions/spanish.ts";
import "./proxy.css";

/** Port part of "host:port". */
const portOf = (listen: string): string => listen.slice(listen.lastIndexOf(":"));

const FORMAT_LABEL: Record<ApiFormat, string> = {
  "openai-chat": "OpenAI chat",
  "openai-responses": "OpenAI responses",
  "anthropic-messages": "Anthropic messages",
};

const OUTCOME_TONE: Record<UsageRecord["outcome"], Tone> = {
  ok: "ok",
  "client-error": "warn",
  "upstream-error": "danger",
  "rate-limited": "warn",
  "failover-exhausted": "danger",
  aborted: "idle",
};

const MIGRATION_STEPS: ClientKeyView["migration"][] = ["cliproxyapi", "both", "bixku-proxy"];
const MIGRATION_LABEL: Record<ClientKeyView["migration"], string> = {
  cliproxyapi: "CLIProxyAPI",
  both: "En paralelo",
  "bixku-proxy": "bixku-proxy",
};
const MIGRATION_TONE: Record<ClientKeyView["migration"], Tone> = { cliproxyapi: "idle", both: "warn", "bixku-proxy": "ok" };

/* ---------------------------------------------------------------- header */

function StatusHeader({ proxy, sourceOk }: { proxy: ProxyStatus; sourceOk: boolean }) {
  const legacy = proxy.legacyProxy;
  return (
    <Card flush data-testid="proxy-status" className="px-status">
      <div className="px-status-main">
        <div className="px-status-id">
          <StatusDot tone={sourceOk ? "ok" : "danger"} />
          <h2>bixku-proxy</h2>
          <Tag>{`v${proxy.version}`}</Tag>
          <Badge dot tone={sourceOk ? "ok" : "danger"}>{sourceOk ? "en línea" : "sin respuesta"}</Badge>
        </div>
        <KeyValue className="px-facts">
          <KV label="Escucha">{proxy.listen}</KV>
          <KV label="Uptime">
            <RelativeTime value={proxy.startedAt} format={(_v, now) => formatSpan(now - Date.parse(proxy.startedAt))} />
          </KV>
          <KV label="Desde">
            <RelativeTime value={proxy.startedAt} format={spanEs} />
          </KV>
        </KeyValue>
      </div>
      <div className="px-legacy" data-testid="proxy-legacy">
        <StatusDot tone={legacy.retired ? "dormant" : "warn"} />
        <span>
          <strong>{legacy.name}</strong> <span className="num u-muted">{legacy.listen}</span>
        </span>
        <Badge tone={legacy.retired ? "dormant" : "warn"}>{legacy.retired ? "retirado" : "en paralelo"}</Badge>
        <p className="u-muted">
          {legacy.retired
            ? "CLIProxyAPI ya fue retirado; su configuración se conserva como respaldo."
            : `CLIProxyAPI sigue corriendo en ${portOf(legacy.listen)} junto a bixku-proxy en ${portOf(proxy.listen)}. No se apaga sin aprobación explícita de Facundo.`}
        </p>
      </div>
    </Card>
  );
}

function LastHour({ proxy }: { proxy: ProxyStatus }) {
  const h = proxy.lastHour;
  const errRate = h.requests > 0 ? (h.errors / h.requests) * 100 : 0;
  return (
    <StatStrip data-testid="proxy-kpis" aria-label="Última hora">
      <Stat label="Requests 1 h" value={formatInt(h.requests)} />
      <Stat label="Errores" value={formatInt(h.errors)} tone={h.errors > 0 ? "danger" : undefined} hint={`${formatPercent(errRate, 1)} de los requests`} />
      <Stat label="Rate-limited" value={formatInt(h.rateLimited)} tone={h.rateLimited > 0 ? "warn" : undefined} />
      <Stat label="Failovers" value={formatInt(h.failovers)} tone={h.failovers > 0 ? "info" : undefined} />
      <Stat label="Latencia p50" value={formatMs(h.p50Ms)} />
      <Stat label="Latencia p95" value={formatMs(h.p95Ms)} />
      <Stat label="Costo 1 h (lista)" value={formatUsd(h.costUsd)} tone="accent" />
    </StatStrip>
  );
}

/* ---------------------------------------------------------------- routes */

function RoutesTable({ proxy }: { proxy: ProxyStatus }) {
  return (
    <Card flush title="Rutas de modelos" actions={<span className="num u-muted">{proxy.routes.length}</span>} data-testid="proxy-routes">
      <Table>
          <thead>
            <tr>
              <th scope="col">Match</th>
              <th scope="col">Proveedor</th>
              <th scope="col">Modelo upstream</th>
              <th scope="col">Cadena de cuentas</th>
            </tr>
          </thead>
          <tbody>
            {proxy.routes.map((r) => (
              <tr key={`${r.match}:${r.provider}`} data-testid={`route-${r.match}`}>
                <td className="num u-strong">{r.match}</td>
                <td>{r.provider}</td>
                <td className="num">{r.upstreamModel ?? <span className="u-faint">sin reescritura</span>}</td>
                <td>
                  {r.accounts.length === 0 ? (
                    <span className="u-muted">{`todas las cuentas de ${r.provider}`}</span>
                  ) : (
                    <ol className="px-chain">
                      {r.accounts.map((a) => (
                        <li key={a} className="num">
                          {a}
                        </li>
                      ))}
                    </ol>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
      </Table>
    </Card>
  );
}

/* ------------------------------------------------------------- migration */

/** Architecture §7: clients move one at a time from CLIProxyAPI to bixku-proxy. */
function Migration({ proxy }: { proxy: ProxyStatus }) {
  const clients = proxy.clients;
  const count = (s: ClientKeyView["migration"]) => clients.filter((c) => c.migration === s).length;
  const total = clients.length;
  const done = count("bixku-proxy");
  const allDone = total > 0 && done === total;
  let x = 0;
  const segments = MIGRATION_STEPS.map((state) => {
    const w = total > 0 ? (count(state) / total) * 100 : 0;
    const seg = { state, x, w };
    x += w;
    return seg;
  }).filter((s) => s.w > 0);
  return (
    <Card
      flush
      title="Migración desde CLIProxyAPI"
      actions={<span className="num u-muted" data-testid="migration-count">{`${done} de ${total} migrados`}</span>}
      data-testid="proxy-migration"
    >
      <div className="px-migration-bar">
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="10" role="img" aria-label={`${done} de ${total} clientes en bixku-proxy`}>
          <rect x="0" y="0" width="100" height="10" className="px-seg-track" />
          {segments.map((s) => (
            <rect key={s.state} x={s.x} y="0" width={s.w} height="10" className={`px-seg px-seg-${s.state}`} />
          ))}
        </svg>
        <ul className="px-legend">
          {MIGRATION_STEPS.map((s) => (
            <li key={s}>
              <StatusDot tone={MIGRATION_TONE[s]} />
              <span>{MIGRATION_LABEL[s]}</span>
              <span className="num u-muted">{count(s)}</span>
            </li>
          ))}
        </ul>
      </div>
      <Table data-testid="clients-table">
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">Modelos permitidos</th>
              <th scope="col">Último uso</th>
              <th scope="col">Migración</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} data-testid={`client-${c.id}`}>
                <td>
                  <div className="u-strong">{c.label}</div>
                  <div className="num u-faint">{c.id}</div>
                </td>
                <td className="num">{c.allowedModels.length === 0 ? <span className="u-muted">todos</span> : c.allowedModels.join(", ")}</td>
                <td className="u-nowrap u-muted"><RelativeTime value={c.lastUsedAt} format={spanEsSeconds} fallback="nunca" /></td>
                <td>
                  <div className="px-stepper" role="img" aria-label={`Migración: ${MIGRATION_LABEL[c.migration]}`}>
                    {MIGRATION_STEPS.map((s, i) => (
                      <span key={s} className={`px-step ${i <= MIGRATION_STEPS.indexOf(c.migration) ? "px-step-on" : ""} tone-${MIGRATION_TONE[c.migration]}`} />
                    ))}
                  </div>
                  <Badge tone={MIGRATION_TONE[c.migration]}>{MIGRATION_LABEL[c.migration]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
      </Table>
      <p className="px-note u-muted" data-testid="migration-note">
        {allDone
          ? "Todos los clientes están en bixku-proxy. Siguiente paso: 7 días sin tráfico en CLIProxyAPI y pedir aprobación a Facundo para apagarlo."
          : "Se mueve un cliente a la vez; si algo falla, el rollback es devolver su base URL a CLIProxyAPI. El apagado requiere 7 días sin tráfico y aprobación explícita."}
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------------- recent */

function RecentTable({ proxy }: { proxy: ProxyStatus }) {
  const maxDur = Math.max(1, ...proxy.recent.map((r) => r.durationMs));
  return (
    <Card flush title="Requests recientes" actions={<span className="num u-muted">{proxy.recent.length}</span>} data-testid="proxy-recent">
      <Table className="px-recent" data-testid="recent-table">
          <thead>
            <tr>
              <th scope="col">Hora</th>
              <th scope="col">Cliente</th>
              <th scope="col">Formato</th>
              <th scope="col">Modelo</th>
              <th scope="col">Cuenta</th>
              <th scope="col">Estado</th>
              <th scope="col" className="u-right">Tokens in/out</th>
              <th scope="col" className="u-right">Cache</th>
              <th scope="col" className="u-right">Costo</th>
              <th scope="col">Duración / TTFT</th>
              <th scope="col">Failover</th>
            </tr>
          </thead>
          <tbody>
            {proxy.recent.map((r) => (
              <tr key={r.id} data-testid="recent-row">
                <td className="u-nowrap u-muted num">
                  <RelativeTime value={r.ts} format={spanEsSeconds} />
                </td>
                <td className="num">{r.clientId}</td>
                <td className="u-nowrap">
                  {FORMAT_LABEL[r.format]}
                  {r.stream ? <span className="u-faint"> · sse</span> : null}
                </td>
                <td className="num">
                  {r.model}
                  {r.requestedModel !== r.model ? <div className="u-faint">{`pedido: ${r.requestedModel}`}</div> : null}
                </td>
                <td className="num">{r.accountId}</td>
                <td className="u-nowrap">
                  <span className="num px-status-code">{r.status}</span> <Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge>
                </td>
                <td className="u-right num u-nowrap">{`${formatTokens(r.inputTokens)} / ${formatTokens(r.outputTokens)}`}</td>
                <td className="u-right num u-nowrap u-muted">{`${formatTokens(r.cacheReadTokens)} / ${formatTokens(r.cacheWriteTokens)}`}</td>
                <td className="u-right num">{formatUsd(r.costUsd)}</td>
                <td className="u-nowrap">
                  <div className="px-dur">
                    <svg viewBox="0 0 100 4" preserveAspectRatio="none" width="48" height="4" aria-hidden="true">
                      <rect x="0" y="0" width="100" height="4" className="px-dur-track" />
                      <rect x="0" y="0" width={(r.durationMs / maxDur) * 100} height="4" className="px-dur-fill" />
                    </svg>
                    <span className="num">{formatMs(r.durationMs)}</span>
                    <span className="num u-faint">{`ttft ${formatMs(r.ttftMs)}`}</span>
                  </div>
                </td>
                <td>
                  {r.failedOver.length === 0 ? (
                    <span className="u-faint">—</span>
                  ) : (
                    <span className="px-failover num" data-testid="failover-chain">
                      {r.failedOver.map((a) => (
                        <span key={a} className="px-failed">{a}</span>
                      ))}
                      <span className="px-arrow" aria-hidden="true">→</span>
                      <span>{r.accountId}</span>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
      </Table>
    </Card>
  );
}

/* ------------------------------------------------------------------ view */

export function ProxyView({ snapshot }: ViewProps) {
  const proxy = snapshot.proxy;
  const src = snapshot.sources.find((s) => s.source === "proxy");

  if (!proxy) {
    return (
      <section className="ui-view px" data-testid="view-proxy">
        <PageHeader title="Proxy" />
        <Card>
          <EmptyState
            data-testid="proxy-empty"
            icon={<Badge tone="idle">sin datos</Badge>}
            title="Sin estado de bixku-proxy"
            description="El hub no tiene estado de bixku-proxy todavía. Puede que aún no esté desplegado (paso 1 del plan de migración) o que el hub no lo alcance."
          >
            {src?.error ? <code className="u-danger">{src.error}</code> : null}
            <p className="u-faint">CLIProxyAPI sigue siendo el proxy en uso mientras no haya aprobación para cambiarlo.</p>
          </EmptyState>
        </Card>
      </section>
    );
  }

  return (
    <section className="ui-view px" data-testid="view-proxy">
      <PageHeader title="Proxy" subtitle="Pool de cuentas, rutas y medición a precio de lista" />
      <StatusHeader proxy={proxy} sourceOk={src ? src.ok : true} />
      <LastHour proxy={proxy} />
      <div className="px-two">
        <RoutesTable proxy={proxy} />
        <Migration proxy={proxy} />
      </div>
      <RecentTable proxy={proxy} />
    </section>
  );
}
