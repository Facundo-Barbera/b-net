import type { AccountView, ProviderId } from "@fhub/core";
import { Card, EmptyState, PageHeader, Stat, StatStrip, useNow } from "../../components/index.ts";
import { sourceStatus } from "../../data/sources.ts";
import { DASH, formatSpan, formatUsdHeadline } from "../../lib/format.ts";
import type { SnapshotViewProps } from "../../routes.tsx";
import { AccountCard, windowLabel } from "./AccountCard.tsx";
import { SourceNotice } from "../shared/SourceNotice.tsx";
import "./subscriptions.css";

const PROVIDER_ORDER: ProviderId[] = ["anthropic", "openai", "google", "openrouter", "other"];
const PROVIDER_NAME: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  other: "Otros",
};

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

/** Accounts come from fhub-proxy: say whether it is missing, failing, or connected with no accounts. */
function NoAccounts({ snapshot }: SnapshotViewProps) {
  const status = sourceStatus(snapshot.sources, "proxy");
  if (status.state !== "ok") return <SourceNotice status={status} testId="subs-empty" />;
  return (
    <Card>
      <EmptyState data-testid="subs-empty" data-source-state="ok" title="Sin cuentas" description="fhub-proxy está conectado pero no tiene cuentas en su pool. Se agregan en su config (accounts)." />
    </Card>
  );
}

export function SubscriptionsView({ snapshot }: SnapshotViewProps) {
  const nowMs = useNow();
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

  const header = <PageHeader eyebrow="Flota" title="Suscripciones" subtitle="Costos a precio de lista, no lo facturado · ventanas según el proveedor" />;
  if (accounts.length === 0) {
    return (
      <section className="ui-view sv" data-testid="view-subscriptions">
        {header}
        <NoAccounts snapshot={snapshot} />
      </section>
    );
  }

  return (
    <section className="ui-view sv" data-testid="view-subscriptions">
      {header}

      <StatStrip data-testid="subs-summary">
        <Stat
          data-testid="sum-cost"
          label="Costo 30 d (precio de lista)"
          value={formatUsdHeadline(cost30)}
          tone="accent"
          hint={
            planTotal > 0
              ? `${(subCost30 / planTotal).toFixed(1)}× sobre ${formatUsdHeadline(planTotal)}/mes en planes`
              : "sin planes de suscripción"
          }
        />
        <Stat
          data-testid="sum-cooldown"
          label="En cooldown"
          value={`${cooling.length} / ${accounts.length}`}
          tone={cooling.length > 0 ? "warn" : "ok"}
          hint={cooling.length > 0 ? cooling.map((a) => a.label).join(", ") : "todas las cuentas disponibles"}
        />
        <Stat
          data-testid="sum-reset"
          label="Próximo reset"
          value={reset ? formatSpan(reset.ms) : DASH}
          hint={reset ? `${reset.account.label} · ${windowLabel(reset.window)}` : "sin resets programados"}
        />
        <Stat
          data-testid="sum-active"
          label="Cuentas activas"
          value={accounts.filter((a) => a.poolState === "active").length}
          hint={`${accounts.length} en el pool`}
        />
      </StatStrip>

      {groups.map((g) => (
        <section key={g.provider} className="sv-group" aria-label={PROVIDER_NAME[g.provider]} data-testid={`provider-${g.provider}`}>
          <header className="sv-group-head">
            <h2 className="ui-label">{PROVIDER_NAME[g.provider]}</h2>
            <span className="u-faint num">
              {g.accounts.length} {g.accounts.length === 1 ? "cuenta" : "cuentas"} · {formatUsdHeadline(g.accounts.reduce((s, a) => s + a.last30d.costUsd, 0))} / 30 d
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
