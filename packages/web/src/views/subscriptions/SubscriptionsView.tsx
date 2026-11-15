import type { AccountView, ProviderId } from "@bixku/core";
import type { ViewProps } from "../../routes.tsx";
import { AccountCard, windowLabel } from "./AccountCard.tsx";
import { fmtSpan, fmtUsd, resolveNow } from "./_shared/format.ts";
import type { NowInput } from "./_shared/format.ts";
import { Dot, Kpi } from "./_shared/ui.tsx";
import "./subscriptions.css";

const PROVIDER_ORDER: ProviderId[] = ["anthropic", "openai", "google", "openrouter", "other"];
const PROVIDER_NAME: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  other: "Otros",
};

export interface SubscriptionsViewProps extends ViewProps {
  /** Reference clock for countdowns. Defaults to `snapshot.generatedAt`. */
  now?: NowInput;
}

/** Earliest window reset still in the future, across all accounts. */
function nearestReset(accounts: AccountView[], nowMs: number) {
  let best: { ms: number; account: AccountView; window: AccountView["windows"][number] } | null = null;
  for (const account of accounts) {
    for (const window of account.windows) {
      if (!window.resetsAt) continue;
      const ms = Date.parse(window.resetsAt) - nowMs;
      if (ms > 0 && (!best || ms < best.ms)) best = { ms, account, window };
    }
  }
  return best;
}

export function SubscriptionsView({ snapshot, now }: SubscriptionsViewProps) {
  const nowMs = resolveNow(snapshot.generatedAt, now);
  const accounts = snapshot.accounts;

  const cost30 = accounts.reduce((s, a) => s + a.last30d.costUsd, 0);
  const subs = accounts.filter((a) => (a.planPriceUsd ?? 0) > 0);
  const planTotal = subs.reduce((s, a) => s + (a.planPriceUsd ?? 0), 0);
  const subCost30 = subs.reduce((s, a) => s + a.last30d.costUsd, 0);
  const cooling = accounts.filter((a) => a.poolState === "cooldown");
  const reset = nearestReset(accounts, nowMs);

  const groups = PROVIDER_ORDER.map((provider) => ({
    provider,
    accounts: accounts.filter((a) => a.provider === provider).sort((a, b) => a.priority - b.priority),
  })).filter((g) => g.accounts.length > 0);

  return (
    <section className="vx sv" data-testid="view-subscriptions">
      <div className="vx-page-head">
        <h1>Subscriptions</h1>
        <span className="vx-page-sub">Costos a precio de lista, no lo facturado · ventanas según el proveedor</span>
      </div>

      <div className="vx-kpis" data-testid="subs-summary">
        <Kpi
          label="Costo 30 d (precio de lista)"
          value={fmtUsd(cost30)}
          tone="accent"
          sub={
            planTotal > 0
              ? `${(subCost30 / planTotal).toFixed(1)}× sobre ${fmtUsd(planTotal)}/mes en planes`
              : "sin planes de suscripción"
          }
          testId="sum-cost"
        />
        <Kpi
          label="En cooldown"
          value={`${cooling.length} / ${accounts.length}`}
          tone={cooling.length > 0 ? "warn" : "ok"}
          sub={cooling.length > 0 ? cooling.map((a) => a.label).join(", ") : "todas las cuentas disponibles"}
          testId="sum-cooldown"
        />
        <Kpi
          label="Próximo reset"
          value={reset ? fmtSpan(reset.ms) : "—"}
          sub={reset ? `${reset.account.label} · ${windowLabel(reset.window)}` : "sin resets programados"}
          testId="sum-reset"
        />
        <Kpi
          label="Cuentas activas"
          value={accounts.filter((a) => a.poolState === "active").length}
          sub={`${accounts.length} en el pool`}
          testId="sum-active"
        />
      </div>

      {groups.length === 0 ? (
        <div className="vx-empty" data-testid="subs-empty">
          <h2 className="vx-eyebrow">Sin cuentas</h2>
          <p>El proxy todavía no reporta cuentas. Revisa la vista Proxy y el estado de las fuentes.</p>
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.provider} className="sv-group" aria-label={PROVIDER_NAME[g.provider]} data-testid={`provider-${g.provider}`}>
          <header className="sv-group-head">
            <Dot tone="accent" />
            <h2 className="vx-eyebrow">{PROVIDER_NAME[g.provider]}</h2>
            <span className="vx-faint num">
              {g.accounts.length} {g.accounts.length === 1 ? "cuenta" : "cuentas"} · {fmtUsd(g.accounts.reduce((s, a) => s + a.last30d.costUsd, 0))} / 30 d
            </span>
          </header>
          <div className="sv-grid">
            {g.accounts.map((a) => (
              <AccountCard key={a.id} account={a} nowMs={nowMs} />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
