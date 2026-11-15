import type { ApiFormat, ClientKeyView, ProxyStatus, UsageRecord } from "@bixku/core";
import type { ViewProps } from "../../routes.tsx";
import { fmtMs, fmtPct, fmtRel, fmtSpan, fmtTokens, fmtUsd2, fmtInt, portOf, resolveNow } from "../subscriptions/_shared/format.ts";
import type { NowInput } from "../subscriptions/_shared/format.ts";
import { Badge, Dot, Kpi, Panel, Tag, Time } from "../subscriptions/_shared/ui.tsx";
import type { Tone } from "../subscriptions/_shared/ui.tsx";
import "./proxy.css";

export interface ProxyViewProps extends ViewProps {
  /** Reference clock for uptime / relative times. Defaults to `snapshot.generatedAt`. */
  now?: NowInput;
}

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

function StatusHeader({ proxy, nowMs, sourceOk }: { proxy: ProxyStatus; nowMs: number; sourceOk: boolean }) {
  const legacy = proxy.legacyProxy;
  return (
    <Panel testId="proxy-status" className="px-status">
      <div className="px-status-main">
        <div className="px-status-id">
          <Dot tone={sourceOk ? "ok" : "danger"} />
          <h2>bixku-proxy</h2>
          <Tag>{`v${proxy.version}`}</Tag>
          <Badge tone={sourceOk ? "ok" : "danger"}>{sourceOk ? "en línea" : "sin respuesta"}</Badge>
        </div>
        <dl className="px-facts">
          <div>
            <dt>Escucha</dt>
            <dd className="num">{proxy.listen}</dd>
          </div>
          <div>
            <dt>Uptime</dt>
            <dd className="num">
              <Time iso={proxy.startedAt}>{fmtSpan(nowMs - Date.parse(proxy.startedAt))}</Time>
            </dd>
          </div>
          <div>
            <dt>Desde</dt>
            <dd className="num">
              <Time iso={proxy.startedAt}>{fmtRel(proxy.startedAt, nowMs)}</Time>
            </dd>
          </div>
        </dl>
      </div>
      <div className="px-legacy" data-testid="proxy-legacy">
        <Dot tone={legacy.retired ? "dormant" : "warn"} />
        <span>
          <strong>{legacy.name}</strong> <span className="num vx-muted">{legacy.listen}</span>
        </span>
        <Badge tone={legacy.retired ? "dormant" : "warn"} dot={false}>
          {legacy.retired ? "retirado" : "en paralelo"}
        </Badge>
        <p className="vx-muted">
          {legacy.retired
            ? "CLIProxyAPI ya fue retirado; su configuración se conserva como respaldo."
            : `CLIProxyAPI sigue corriendo en ${portOf(legacy.listen)} junto a bixku-proxy en ${portOf(proxy.listen)}. No se apaga sin aprobación explícita de Facundo.`}
        </p>
      </div>
    </Panel>
  );
}

function LastHour({ proxy }: { proxy: ProxyStatus }) {
  const h = proxy.lastHour;
  const errRate = h.requests > 0 ? (h.errors / h.requests) * 100 : 0;
  return (
    <div className="vx-kpis" data-testid="proxy-kpis" aria-label="Última hora">
      <Kpi label="Requests 1 h" value={fmtInt(h.requests)} />
      <Kpi label="Errores" value={fmtInt(h.errors)} tone={h.errors > 0 ? "danger" : undefined} sub={`${fmtPct(errRate)} de los requests`} />
      <Kpi label="Rate-limited" value={fmtInt(h.rateLimited)} tone={h.rateLimited > 0 ? "warn" : undefined} />
      <Kpi label="Failovers" value={fmtInt(h.failovers)} tone={h.failovers > 0 ? "info" : undefined} />
      <Kpi label="Latencia p50" value={fmtMs(h.p50Ms)} />
      <Kpi label="Latencia p95" value={fmtMs(h.p95Ms)} />
      <Kpi label="Costo 1 h (lista)" value={fmtUsd2(h.costUsd)} tone="accent" />
    </div>
  );
}

/* ---------------------------------------------------------------- routes */

function RoutesTable({ proxy }: { proxy: ProxyStatus }) {
  return (
    <Panel title="Rutas de modelos" aside={<span className="num">{proxy.routes.length}</span>} testId="proxy-routes">
      <div className="vx-table-wrap">
        <table className="vx-table">
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
                <td className="vx-mono vx-strong">{r.match}</td>
                <td>{r.provider}</td>
                <td className="vx-mono">{r.upstreamModel ?? <span className="vx-faint">sin reescritura</span>}</td>
                <td>
                  {r.accounts.length === 0 ? (
                    <span className="vx-muted">{`todas las cuentas de ${r.provider}`}</span>
                  ) : (
                    <ol className="px-chain">
                      {r.accounts.map((a) => (
                        <li key={a} className="vx-mono">
                          {a}
                        </li>
                      ))}
                    </ol>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- migration */

/** Architecture §7: clients move one at a time from CLIProxyAPI to bixku-proxy. */
function Migration({ proxy, nowMs }: { proxy: ProxyStatus; nowMs: number }) {
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
    <Panel
      title="Migración desde CLIProxyAPI"
      aside={<span className="num" data-testid="migration-count">{`${done} de ${total} migrados`}</span>}
      testId="proxy-migration"
    >
      <div className="px-migration-bar vx-pad">
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="10" role="img" aria-label={`${done} de ${total} clientes en bixku-proxy`}>
          <rect x="0" y="0" width="100" height="10" className="px-seg-track" />
          {segments.map((s) => (
            <rect key={s.state} x={s.x} y="0" width={s.w} height="10" className={`px-seg px-seg-${s.state}`} />
          ))}
        </svg>
        <ul className="px-legend">
          {MIGRATION_STEPS.map((s) => (
            <li key={s}>
              <Dot tone={MIGRATION_TONE[s]} />
              <span>{MIGRATION_LABEL[s]}</span>
              <span className="num vx-muted">{count(s)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="vx-table-wrap">
        <table className="vx-table" data-testid="clients-table">
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
                  <div className="vx-strong">{c.label}</div>
                  <div className="vx-mono vx-faint">{c.id}</div>
                </td>
                <td className="vx-mono">{c.allowedModels.length === 0 ? <span className="vx-muted">todos</span> : c.allowedModels.join(", ")}</td>
                <td className="vx-nowrap vx-muted">{c.lastUsedAt ? <Time iso={c.lastUsedAt}>{fmtRel(c.lastUsedAt, nowMs, { seconds: true })}</Time> : "nunca"}</td>
                <td>
                  <div className="px-stepper" role="img" aria-label={`Migración: ${MIGRATION_LABEL[c.migration]}`}>
                    {MIGRATION_STEPS.map((s, i) => (
                      <span key={s} className={`px-step ${i <= MIGRATION_STEPS.indexOf(c.migration) ? "px-step-on" : ""} vx-tone-${MIGRATION_TONE[c.migration]}`} />
                    ))}
                  </div>
                  <Badge tone={MIGRATION_TONE[c.migration]}>{MIGRATION_LABEL[c.migration]}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-note vx-muted" data-testid="migration-note">
        {allDone
          ? "Todos los clientes están en bixku-proxy. Siguiente paso: 7 días sin tráfico en CLIProxyAPI y pedir aprobación a Facundo para apagarlo."
          : "Se mueve un cliente a la vez; si algo falla, el rollback es devolver su base URL a CLIProxyAPI. El apagado requiere 7 días sin tráfico y aprobación explícita."}
      </p>
    </Panel>
  );
}

/* ---------------------------------------------------------------- recent */

function RecentTable({ proxy, nowMs }: { proxy: ProxyStatus; nowMs: number }) {
  const maxDur = Math.max(1, ...proxy.recent.map((r) => r.durationMs));
  return (
    <Panel title="Requests recientes" aside={<span className="num">{proxy.recent.length}</span>} testId="proxy-recent">
      <div className="vx-table-wrap">
        <table className="vx-table px-recent" data-testid="recent-table">
          <thead>
            <tr>
              <th scope="col">Hora</th>
              <th scope="col">Cliente</th>
              <th scope="col">Formato</th>
              <th scope="col">Modelo</th>
              <th scope="col">Cuenta</th>
              <th scope="col">Estado</th>
              <th scope="col" className="vx-r">Tokens in/out</th>
              <th scope="col" className="vx-r">Cache</th>
              <th scope="col" className="vx-r">Costo</th>
              <th scope="col">Duración / TTFT</th>
              <th scope="col">Failover</th>
            </tr>
          </thead>
          <tbody>
            {proxy.recent.map((r) => (
              <tr key={r.id} data-testid="recent-row">
                <td className="vx-nowrap vx-muted num">
                  <Time iso={r.ts}>{fmtRel(r.ts, nowMs, { seconds: true })}</Time>
                </td>
                <td className="vx-mono">{r.clientId}</td>
                <td className="vx-nowrap">
                  {FORMAT_LABEL[r.format]}
                  {r.stream ? <span className="vx-faint"> · sse</span> : null}
                </td>
                <td className="vx-mono">
                  {r.model}
                  {r.requestedModel !== r.model ? <div className="vx-faint">{`pedido: ${r.requestedModel}`}</div> : null}
                </td>
                <td className="vx-mono">{r.accountId}</td>
                <td className="vx-nowrap">
                  <span className="num px-status-code">{r.status}</span> <Badge tone={OUTCOME_TONE[r.outcome]}>{r.outcome}</Badge>
                </td>
                <td className="vx-r num vx-nowrap">{`${fmtTokens(r.inputTokens)} / ${fmtTokens(r.outputTokens)}`}</td>
                <td className="vx-r num vx-nowrap vx-muted">{`${fmtTokens(r.cacheReadTokens)} / ${fmtTokens(r.cacheWriteTokens)}`}</td>
                <td className="vx-r num">{r.costUsd === null ? "—" : fmtUsd2(r.costUsd)}</td>
                <td className="vx-nowrap">
                  <div className="px-dur">
                    <svg viewBox="0 0 100 4" preserveAspectRatio="none" width="48" height="4" aria-hidden="true">
                      <rect x="0" y="0" width="100" height="4" className="px-dur-track" />
                      <rect x="0" y="0" width={(r.durationMs / maxDur) * 100} height="4" className="px-dur-fill" />
                    </svg>
                    <span className="num">{fmtMs(r.durationMs)}</span>
                    <span className="num vx-faint">{`ttft ${fmtMs(r.ttftMs)}`}</span>
                  </div>
                </td>
                <td>
                  {r.failedOver.length === 0 ? (
                    <span className="vx-faint">—</span>
                  ) : (
                    <span className="px-failover vx-mono" data-testid="failover-chain">
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
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ view */

export function ProxyView({ snapshot, now }: ProxyViewProps) {
  const nowMs = resolveNow(snapshot.generatedAt, now);
  const proxy = snapshot.proxy;
  const src = snapshot.sources.find((s) => s.source === "proxy");

  if (!proxy) {
    return (
      <section className="vx px" data-testid="view-proxy">
        <div className="vx-page-head">
          <h1>Proxy</h1>
        </div>
        <div className="vx-empty" data-testid="proxy-empty">
          <Badge tone="idle">sin datos</Badge>
          <p>
            El hub no tiene estado de bixku-proxy todavía. Puede que aún no esté desplegado (paso 1 del plan de migración) o que
            el hub no lo alcance.
          </p>
          {src?.error ? <code className="vx-danger-text">{src.error}</code> : null}
          <p className="vx-faint">CLIProxyAPI sigue siendo el proxy en uso mientras no haya aprobación para cambiarlo.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="vx px" data-testid="view-proxy">
      <div className="vx-page-head">
        <h1>Proxy</h1>
        <span className="vx-page-sub">Pool de cuentas, rutas y medición a precio de lista</span>
      </div>
      <StatusHeader proxy={proxy} nowMs={nowMs} sourceOk={src ? src.ok : true} />
      <LastHour proxy={proxy} />
      <div className="px-two">
        <RoutesTable proxy={proxy} />
        <Migration proxy={proxy} nowMs={nowMs} />
      </div>
      <RecentTable proxy={proxy} nowMs={nowMs} />
    </section>
  );
}
