import type { AccountView, UsageTotals, UsageWindow } from "@bixku/core";
import { Badge, Callout, Card, KV, KeyValue, Meter, RelativeTime, Table, Tag, meterTone, toneForPoolState, type Tone } from "../../components/index.ts";
import { USAGE_DANGER_AT } from "../../lib/thresholds.ts";
import { formatCountdown, formatInt, formatMoney, formatTokens, formatUsd, formatUsdHeadline, DASH } from "../../lib/format.ts";
import { expiresText, resetText, spanEs } from "./spanish.ts";

const SOURCE_HINT: Record<UsageWindow["source"], string> = {
  "provider-headers": "Leído de los headers de rate-limit del proveedor (autoritativo)",
  estimated: "Calculado con nuestra propia medición contra un presupuesto configurado",
  manual: "Capturado a mano",
};
const KIND_LABEL: Record<UsageWindow["kind"], string> = { "5h": "5 h", weekly: "Semanal", monthly: "Mensual" };

export const windowLabel = (w: UsageWindow): string => (w.scope ? `${KIND_LABEL[w.kind]} · ${w.scope}` : KIND_LABEL[w.kind]);

function Measured({ t, emphasis }: { t: UsageTotals; emphasis?: boolean }) {
  return (
    <div className={`sv-measured num ${emphasis ? "sv-measured-strong" : ""}`}>
      <span className="ui-label">{emphasis ? "Medido propio" : "Medido"}</span>
      <span>{formatInt(t.requests)} req</span>
      <span>{formatTokens(t.inputTokens)} in</span>
      <span>{formatTokens(t.outputTokens)} out</span>
      <span>{formatUsd(t.costUsd)}</span>
    </div>
  );
}

function WindowRow({ account, w }: { account: AccountView; w: UsageWindow }) {
  const id = `win-${account.id}-${w.kind}${w.scope ? `-${w.scope}` : ""}`;
  const label = windowLabel(w);
  const tone: Tone = w.usedPct === null ? "neutral" : meterTone(w.usedPct);
  return (
    <li className="sv-window" data-testid={id}>
      <div className="sv-window-head">
        <span className="sv-window-label">{label}</span>
        <span className={`sv-window-pct num tone-${tone}`} data-empty={w.usedPct === null || undefined}>
          {w.usedPct === null ? "sin dato" : `${w.usedPct}%`}
        </span>
      </div>
      <Meter value={w.usedPct} ariaLabel={`Uso ${label} de ${account.label}`} valueText={w.usedPct === null ? "sin dato" : undefined} />
      <div className="sv-window-foot">
        {w.resetsAt ? <RelativeTime className="num" value={w.resetsAt} format={resetText} /> : <span className="num">reset desconocido</span>}
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
    <Table dense className="sv-totals" aria-label={`Totales de ${account.label}`}>
      <thead>
        <tr>
          <th scope="col">Periodo</th>
          <th scope="col" className="u-right">Req</th>
          <th scope="col" className="u-right">Entrada</th>
          <th scope="col" className="u-right">Salida</th>
          <th scope="col" className="u-right">Cache lect.</th>
          <th scope="col" className="u-right">Cache escr.</th>
          <th scope="col" className="u-right">Costo lista</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, t]) => (
          <tr key={name}>
            <th scope="row" className="u-muted">{name}</th>
            <td className="u-right num">{formatInt(t.requests)}</td>
            <td className="u-right num">{formatTokens(t.inputTokens)}</td>
            <td className="u-right num">{formatTokens(t.outputTokens)}</td>
            <td className="u-right num">{formatTokens(t.cacheReadTokens)}</td>
            <td className="u-right num">{formatTokens(t.cacheWriteTokens)}</td>
            <td className="u-right num u-strong">{formatUsd(t.costUsd)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
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
        <strong>{formatUsdHeadline(cost)}</strong>
        {" a precio de lista por "}
        <strong>{formatUsdHeadline(price)}</strong>
        {"/mes = "}
        <strong className="u-accent">{`${mult.toFixed(1)}×`}</strong>
      </p>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" width="100%" height="10" role="img" aria-label={`Costo a precio de lista ${formatUsdHeadline(cost)} contra plan ${formatUsdHeadline(price)}`}>
        <rect x="0" y="0" width="100" height="4" className="sv-bar-bg" />
        <rect x="0" y="0" width={(cost / max) * 100} height="4" className="sv-bar-cost" />
        <rect x="0" y="6" width="100" height="4" className="sv-bar-bg" />
        <rect x="0" y="6" width={(price / max) * 100} height="4" className="sv-bar-plan" />
      </svg>
    </div>
  );
}

function CreditsPanel({ account }: { account: AccountView }) {
  const c = account.credits;
  if (!c) return null;
  const fund = c.granted ?? (c.balance !== null && c.spent !== null ? c.balance + c.spent : null);
  const spentPct = fund && c.spent !== null ? Math.min(100, (c.spent / fund) * 100) : null;
  const money = (n: number | null) => formatMoney(n, c.currency);
  return (
    <section className="sv-credits" aria-label={`Créditos de ${account.label}`} data-testid={`credits-${account.id}`}>
      <div className="sv-credits-head">
        <span className="ui-label">Créditos</span>
        <Tag title="Origen del dato">{c.source}</Tag>
      </div>
      <div className="sv-credits-balance">
        <span className="sv-credits-balance-value num" data-testid={`credits-balance-${account.id}`}>{money(c.balance)}</span>
        <span className="u-muted">saldo</span>
      </div>
      <Meter
        value={spentPct}
        tone={spentPct !== null && spentPct >= USAGE_DANGER_AT ? "danger" : "accent"}
        ariaLabel={`Créditos gastados de ${account.label}`}
        valueText={spentPct === null ? "sin dato" : undefined}
      />
      <KeyValue>
        <KV label="Otorgado">{money(c.granted)}</KV>
        <KV label="Gastado">{money(c.spent)}</KV>
        <KV label="Expira">
          {c.expiresAt ? <RelativeTime value={c.expiresAt} format={expiresText} /> : "sin vencimiento"}
        </KV>
        <KV label="Actualizado">
          <RelativeTime value={c.updatedAt} format={spanEs} fallback={DASH} />
        </KV>
      </KeyValue>
    </section>
  );
}

export function AccountCard({ account, nowMs }: { account: AccountView; nowMs: number }) {
  const cool = account.poolState === "cooldown" ? formatCountdown(account.cooldownUntil, nowMs) : null;
  const price = account.planPriceUsd;
  return (
    <Card className="sv-card" bodyClassName="sv-card__body" data-testid={`account-${account.id}`}>
      <header className="sv-card-head">
        <div className="sv-card-title">
          <h3>{account.label}</h3>
          <div className="sv-card-plan">
            <span>{account.plan}</span>
            <span className="u-faint">·</span>
            <span className="num">{price ? `${formatUsdHeadline(price)}/mes` : "pago por uso"}</span>
          </div>
        </div>
        <Badge dot tone={toneForPoolState(account.poolState)}>{account.poolState}</Badge>
      </header>

      <div className="sv-card-meta">
        <Tag title="Cómo se autentica el proxy contra el proveedor">
          {account.authKind === "oauth-subscription" ? "oauth · suscripción" : "api-key"}
        </Tag>
        <Tag title="Menor número = preferida en el pool">{`prioridad ${account.priority}`}</Tag>
        <span className="u-muted sv-lastused">
          {account.lastUsedAt ? <RelativeTime value={account.lastUsedAt} format={(v, n) => `último uso ${spanEs(v, n)}`} /> : "sin uso"}
        </span>
      </div>

      {account.poolState === "cooldown" ? (
        <Callout tone="warn" role="status" className="sv-alert">
          <strong>En cooldown</strong>
          <span className="num">{cool ? `reanuda en ${cool}` : "reanudación pendiente"}</span>
        </Callout>
      ) : null}
      {account.lastError ? (
        <Callout tone={account.poolState === "error" ? "danger" : "neutral"} role={account.poolState === "error" ? "alert" : undefined} className="sv-alert">
          <span className="ui-label">Último error</span>
          <code>{account.lastError}</code>
        </Callout>
      ) : null}

      {account.windows.length > 0 ? (
        <ul className="sv-windows" aria-label={`Ventanas de uso de ${account.label}`}>
          {account.windows.map((w) => (
            <WindowRow key={`${w.kind}:${w.scope ?? ""}`} account={account} w={w} />
          ))}
        </ul>
      ) : account.credits ? null : (
        <p className="u-muted sv-nowin">Sin ventanas de uso reportadas.</p>
      )}

      <CreditsPanel account={account} />
      <TotalsTable account={account} />
      <ValueStrip account={account} />
    </Card>
  );
}
