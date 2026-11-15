import type { AccountView, PoolState, UsageTotals, UsageWindow } from "@bixku/core";
import { countdown, fmtInt, fmtMoney, fmtRel, fmtTokens, fmtUsd, fmtUsd2 } from "./_shared/format.ts";
import { Badge, Meter, Panel, Tag, Time } from "./_shared/ui.tsx";
import type { Tone } from "./_shared/ui.tsx";

const POOL_TONE: Record<PoolState, Tone> = { active: "ok", standby: "info", cooldown: "warn", disabled: "dormant", error: "danger" };
const SOURCE_TONE: Record<UsageWindow["source"], Tone> = { "provider-headers": "ok", estimated: "warn", manual: "info" };
const SOURCE_HINT: Record<UsageWindow["source"], string> = {
  "provider-headers": "Leído de los headers de rate-limit del proveedor (autoritativo)",
  estimated: "Calculado con nuestra propia medición contra un presupuesto configurado",
  manual: "Capturado a mano",
};
const KIND_LABEL: Record<UsageWindow["kind"], string> = { "5h": "5 h", weekly: "Semanal", monthly: "Mensual" };

export const windowLabel = (w: UsageWindow): string => (w.scope ? `${KIND_LABEL[w.kind]} · ${w.scope}` : KIND_LABEL[w.kind]);

function pctTone(pct: number | null): Tone {
  if (pct === null) return "muted";
  if (pct >= 90) return "danger";
  if (pct >= 70) return "warn";
  return "ok";
}

function Measured({ t, emphasis }: { t: UsageTotals; emphasis?: boolean }) {
  return (
    <div className={`sv-measured num ${emphasis ? "sv-measured-strong" : ""}`}>
      <span className="vx-eyebrow">{emphasis ? "Medido propio" : "Medido"}</span>
      <span>{fmtInt(t.requests)} req</span>
      <span>{fmtTokens(t.inputTokens)} in</span>
      <span>{fmtTokens(t.outputTokens)} out</span>
      <span>{fmtUsd2(t.costUsd)}</span>
    </div>
  );
}

function WindowRow({ account, w, nowMs }: { account: AccountView; w: UsageWindow; nowMs: number }) {
  const left = countdown(w.resetsAt, nowMs);
  const reset = w.resetsAt === null ? "reset desconocido" : left ? `resetea en ${left}` : "reset pendiente";
  const id = `win-${account.id}-${w.kind}${w.scope ? `-${w.scope}` : ""}`;
  const label = windowLabel(w);
  return (
    <li className="sv-window" data-testid={id}>
      <div className="sv-window-head">
        <span className="sv-window-label">{label}</span>
        <span className="sv-window-pct num" data-tone={pctTone(w.usedPct)}>
          {w.usedPct === null ? "sin dato" : `${w.usedPct}%`}
        </span>
      </div>
      <Meter pct={w.usedPct} tone={pctTone(w.usedPct)} label={`Uso ${label} de ${account.label}`} />
      <div className="sv-window-foot">
        {w.resetsAt ? (
          <Time iso={w.resetsAt}>
            <span className="num">{reset}</span>
          </Time>
        ) : (
          <span className="num">{reset}</span>
        )}
        <Tag title={SOURCE_HINT[w.source]}>{w.source}</Tag>
      </div>
      <Measured t={w.totals} emphasis={w.usedPct === null} />
    </li>
  );
}

function TotalsTable({ account }: { account: AccountView }) {
  const rows: [string, UsageTotals][] = [
    ["Hoy", account.today],
    ["7 d", account.last7d],
    ["30 d", account.last30d],
  ];
  return (
    <div className="vx-table-wrap">
      <table className="vx-table sv-totals" aria-label={`Totales de ${account.label}`}>
        <thead>
          <tr>
            <th scope="col">Periodo</th>
            <th scope="col" className="vx-r">Req</th>
            <th scope="col" className="vx-r">Entrada</th>
            <th scope="col" className="vx-r">Salida</th>
            <th scope="col" className="vx-r">Cache lect.</th>
            <th scope="col" className="vx-r">Cache escr.</th>
            <th scope="col" className="vx-r">Costo lista</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, t]) => (
            <tr key={name}>
              <th scope="row" className="vx-muted">{name}</th>
              <td className="vx-r num">{fmtInt(t.requests)}</td>
              <td className="vx-r num">{fmtTokens(t.inputTokens)}</td>
              <td className="vx-r num">{fmtTokens(t.outputTokens)}</td>
              <td className="vx-r num">{fmtTokens(t.cacheReadTokens)}</td>
              <td className="vx-r num">{fmtTokens(t.cacheWriteTokens)}</td>
              <td className="vx-r num vx-strong">{fmtUsd2(t.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "$3,980 a precio de lista por $200/mes = 19.9×" with a cost-vs-price bar (SVG). */
function ValueStrip({ account }: { account: AccountView }) {
  const price = account.planPriceUsd;
  const cost = account.last30d.costUsd;
  if (!price || price <= 0 || cost <= 0) return null;
  const mult = cost / price;
  const max = Math.max(cost, price);
  return (
    <div className="sv-value" data-testid={`value-${account.id}`}>
      <p className="sv-value-text num">
        <strong>{fmtUsd(cost)}</strong>
        {" a precio de lista por "}
        <strong>{fmtUsd(price)}</strong>
        {"/mes = "}
        <strong className="vx-accent">{`${mult.toFixed(1)}×`}</strong>
      </p>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="10" role="img" aria-label={`Costo a precio de lista ${fmtUsd(cost)} contra plan ${fmtUsd(price)}`}>
        <rect x="0" y="0" width="100" height="4" className="sv-bar-bg" />
        <rect x="0" y="0" width={(cost / max) * 100} height="4" className="sv-bar-cost" />
        <rect x="0" y="6" width="100" height="4" className="sv-bar-bg" />
        <rect x="0" y="6" width={(price / max) * 100} height="4" className="sv-bar-plan" />
      </svg>
    </div>
  );
}

function CreditsPanel({ account, nowMs }: { account: AccountView; nowMs: number }) {
  const c = account.credits;
  if (!c) return null;
  const fund = c.granted ?? (c.balance !== null && c.spent !== null ? c.balance + c.spent : null);
  const spentPct = fund && c.spent !== null ? Math.min(100, (c.spent / fund) * 100) : null;
  const expires = countdown(c.expiresAt, nowMs);
  const money = (n: number | null) => (n === null ? "—" : fmtMoney(n, c.currency));
  return (
    <section className="sv-credits" aria-label={`Créditos de ${account.label}`} data-testid={`credits-${account.id}`}>
      <div className="sv-credits-head">
        <span className="vx-eyebrow">Créditos</span>
        <Tag title="Origen del dato">{c.source}</Tag>
      </div>
      <div className="sv-credits-balance">
        <span className="sv-credits-balance-value num" data-testid={`credits-balance-${account.id}`}>{money(c.balance)}</span>
        <span className="vx-muted">saldo</span>
      </div>
      <Meter pct={spentPct} tone={spentPct !== null && spentPct >= 90 ? "danger" : "accent"} label={`Créditos gastados de ${account.label}`} />
      <dl className="sv-credits-grid num">
        <div><dt>Otorgado</dt><dd>{money(c.granted)}</dd></div>
        <div><dt>Gastado</dt><dd>{money(c.spent)}</dd></div>
        <div>
          <dt>Expira</dt>
          <dd>
            {c.expiresAt ? (
              <Time iso={c.expiresAt}>{expires ? `en ${expires}` : "vencido"}</Time>
            ) : (
              "sin vencimiento"
            )}
          </dd>
        </div>
        <div>
          <dt>Actualizado</dt>
          <dd>{c.updatedAt ? <Time iso={c.updatedAt}>{fmtRel(c.updatedAt, nowMs)}</Time> : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

export function AccountCard({ account, nowMs }: { account: AccountView; nowMs: number }) {
  const cool = account.poolState === "cooldown" ? countdown(account.cooldownUntil, nowMs) : null;
  const price = account.planPriceUsd;
  return (
    <Panel className="sv-card" testId={`account-${account.id}`}>
      <header className="sv-card-head">
        <div className="sv-card-title">
          <h3>{account.label}</h3>
          <div className="sv-card-plan">
            <span>{account.plan}</span>
            <span className="vx-faint">·</span>
            <span className="num">{price ? `${fmtUsd(price)}/mes` : "pago por uso"}</span>
          </div>
        </div>
        <div className="sv-card-badges">
          <Badge tone={POOL_TONE[account.poolState]}>{account.poolState}</Badge>
        </div>
      </header>

      <div className="sv-card-meta">
        <Tag title="Cómo se autentica el proxy contra el proveedor">
          {account.authKind === "oauth-subscription" ? "oauth · suscripción" : "api-key"}
        </Tag>
        <Tag title="Menor número = preferida en el pool">{`prioridad ${account.priority}`}</Tag>
        <span className="vx-muted sv-lastused">
          {account.lastUsedAt ? <Time iso={account.lastUsedAt}>{`último uso ${fmtRel(account.lastUsedAt, nowMs)}`}</Time> : "sin uso"}
        </span>
      </div>

      {account.poolState === "cooldown" ? (
        <div className="sv-alert sv-alert-warn" role="status">
          <strong>En cooldown</strong>
          <span className="num">{cool ? `reanuda en ${cool}` : "reanudación pendiente"}</span>
        </div>
      ) : null}
      {account.lastError ? (
        <div className={`sv-alert ${account.poolState === "error" ? "sv-alert-danger" : "sv-alert-muted"}`} role={account.poolState === "error" ? "alert" : undefined}>
          <span className="vx-eyebrow">Último error</span>
          <code>{account.lastError}</code>
        </div>
      ) : null}

      {account.windows.length > 0 ? (
        <ul className="sv-windows" aria-label={`Ventanas de uso de ${account.label}`}>
          {account.windows.map((w) => (
            <WindowRow key={`${w.kind}:${w.scope ?? ""}`} account={account} w={w} nowMs={nowMs} />
          ))}
        </ul>
      ) : account.credits ? null : (
        <p className="vx-muted sv-nowin">Sin ventanas de uso reportadas.</p>
      )}

      <CreditsPanel account={account} nowMs={nowMs} />
      <TotalsTable account={account} />
      <ValueStrip account={account} />
    </Panel>
  );
}
