import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { snapshotFixture } from "@b-net/core";
import type { HubSnapshot } from "@b-net/core";
import { SubscriptionsView } from "../src/views/subscriptions/SubscriptionsView.tsx";
import { formatCountdown, formatSpan, formatTokens, formatUsdHeadline } from "../src/lib/format.ts";
import { NOW_MS, renderAt } from "./helpers.tsx";

const card = (id: string) => screen.getByTestId(`account-${id}`);

describe("format helpers", () => {
  it("formats spans and countdowns against an injected now", () => {
    expect(formatSpan(130 * 60_000)).toBe("2h 10m");
    expect(formatSpan((4 * 1440 + 200) * 60_000)).toBe("4d 3h");
    expect(formatSpan(20_000)).toBe("<1m");
    const now = NOW_MS;
    expect(formatCountdown(new Date(now + 38 * 60_000).toISOString(), now)).toBe("38m");
    expect(formatCountdown(new Date(now - 1).toISOString(), now)).toBeNull();
  });
  it("formats money and tokens", () => {
    expect(formatUsdHeadline(3980.2)).toBe("$3,980");
    expect(formatUsdHeadline(41.26)).toBe("$41.26");
    expect(formatUsdHeadline(200)).toBe("$200");
    expect(formatTokens(9_820_000)).toBe("9.82M");
    expect(formatTokens(512_000_000)).toBe("512M");
    expect(formatTokens(840)).toBe("840");
  });
});

describe("SubscriptionsView", () => {
  it("groups accounts per provider", () => {
    renderAt(<SubscriptionsView snapshot={snapshotFixture} />);
    expect(screen.getByTestId("view-subscriptions")).toBeTruthy();
    expect(within(screen.getByTestId("provider-anthropic")).getAllByTestId(/^account-/)).toHaveLength(3);
    expect(within(screen.getByTestId("provider-openai")).getAllByTestId(/^account-/)).toHaveLength(1);
    expect(within(screen.getByTestId("provider-openrouter")).getAllByTestId(/^account-/)).toHaveLength(1);
  });

  it("shows the top summary: 30d list cost, cooldowns and nearest reset", () => {
    renderAt(<SubscriptionsView snapshot={snapshotFixture} />);
    const total = 3980.2 + 1201.0 + 256.0 + 8.74 + 2.11;
    expect(within(screen.getByTestId("sum-cost")).getByText(`$${Math.round(total).toLocaleString("en-US")}`)).toBeTruthy();
    expect(within(screen.getByTestId("sum-cooldown")).getByText("1 / 5")).toBeTruthy();
    expect(within(screen.getByTestId("sum-cooldown")).getByText(/trabajo/)).toBeTruthy();
    const reset = screen.getByTestId("sum-reset");
    expect(within(reset).getByText("38m")).toBeTruthy();
    expect(within(reset).getByText(/trabajo · 5 h/)).toBeTruthy();
  });

  it("anthropic-max-2: cooldown with countdown, last error and a 100% 5h window", () => {
    renderAt(<SubscriptionsView snapshot={snapshotFixture} />);
    const c = within(card("anthropic-max-2"));
    expect(c.getByText("cooldown")).toBeTruthy();
    expect(c.getByText("reanuda en 38m")).toBeTruthy();
    expect(c.getByText(/429 rate_limit_error/)).toBeTruthy();
    const w = within(c.getByTestId("win-anthropic-max-2-5h"));
    expect(w.getByText("100%")).toBeTruthy();
    expect(w.getByText("resetea en 38m")).toBeTruthy();
    expect(w.getByRole("meter").getAttribute("aria-valuenow")).toBe("100");
    expect(w.getByText("provider-headers")).toBeTruthy();
  });

  it("anthropic-max-1: 5h, weekly and opus-scoped weekly windows with reset countdowns", () => {
    renderAt(<SubscriptionsView snapshot={snapshotFixture} />);
    const c = within(card("anthropic-max-1"));
    expect(c.getByText("Claude Max 20x")).toBeTruthy();
    expect(c.getByText("$200/mes")).toBeTruthy();
    expect(c.getByText("oauth · suscripción")).toBeTruthy();
    expect(c.getByText("prioridad 0")).toBeTruthy();
    expect(within(c.getByTestId("win-anthropic-max-1-5h")).getByText("resetea en 2h 10m")).toBeTruthy();
    expect(within(c.getByTestId("win-anthropic-max-1-5h")).getByText("64%")).toBeTruthy();
    const opus = within(c.getByTestId("win-anthropic-max-1-weekly-opus"));
    expect(opus.getByText("Semanal · opus")).toBeTruthy();
    expect(opus.getByText("57%")).toBeTruthy();
    expect(opus.getByText("resetea en 4d 3h")).toBeTruthy();
    expect(c.getByTestId("win-anthropic-max-1-weekly")).toBeTruthy();
  });

  it("shows totals and the value strip (list price vs plan price)", () => {
    renderAt(<SubscriptionsView snapshot={snapshotFixture} />);
    const c = within(card("anthropic-max-1"));
    expect(c.getByText("$3,980.20")).toBeTruthy();
    expect(c.getByText("$182.70")).toBeTruthy();
    expect(c.getByTestId("value-anthropic-max-1").textContent).toContain("$3,980 a precio de lista por $200/mes = 19.9×");
    expect(within(card("anthropic-max-2")).getByTestId("value-anthropic-max-2").textContent).toContain("$1,201 a precio de lista por $100/mes = 12.0×");
  });

  it("anthropic-api-1: credits panel, standby state, null usedPct => 'sin dato' + own totals", () => {
    renderAt(<SubscriptionsView snapshot={snapshotFixture} />);
    const c = within(card("anthropic-api-1"));
    expect(c.getByText("standby")).toBeTruthy();
    expect(c.getByTestId("credits-balance-anthropic-api-1").textContent).toBe("$41.26");
    const credits = within(c.getByTestId("credits-anthropic-api-1"));
    expect(credits.getByText("$50.00")).toBeTruthy();
    expect(credits.getByText("$8.74")).toBeTruthy();
    expect(credits.getByText("manual")).toBeTruthy();
    expect(credits.getByText(/en 200d/)).toBeTruthy();
    const w = within(c.getByTestId("win-anthropic-api-1-monthly"));
    expect(w.getByText("sin dato")).toBeTruthy();
    expect(w.getByText("Medido propio")).toBeTruthy();
    expect(w.getByText("84 req")).toBeTruthy();
    expect(w.getByText("estimated")).toBeTruthy();
    expect(w.getByRole("meter").getAttribute("aria-valuenow")).toBeNull();
    // pay-as-you-go: no plan to amortise
    expect(c.queryByTestId("value-anthropic-api-1")).toBeNull();
  });

  it("disabled account shows state and credits without windows", () => {
    renderAt(<SubscriptionsView snapshot={snapshotFixture} />);
    const c = within(card("openrouter-1"));
    expect(c.getByText("disabled")).toBeTruthy();
    expect(c.getByTestId("credits-balance-openrouter-1").textContent).toBe("$12.50");
    expect(c.getByText("sin vencimiento")).toBeTruthy();
  });

  it("error state surfaces lastError as an alert", () => {
    const snap: HubSnapshot = {
      ...snapshotFixture,
      accounts: snapshotFixture.accounts.map((a) =>
        a.id === "openai-pro-1" ? { ...a, poolState: "error", lastError: "401 invalid_grant: re-login required" } : a,
      ),
    };
    renderAt(<SubscriptionsView snapshot={snap} />);
    const alert = within(card("openai-pro-1")).getByRole("alert");
    expect(alert.textContent).toContain("401 invalid_grant");
    expect(within(card("openai-pro-1")).getByText("error")).toBeTruthy();
  });

  it("countdowns follow the injected now", () => {
    renderAt(<SubscriptionsView snapshot={snapshotFixture} />, NOW_MS + 8 * 60_000);
    expect(within(card("anthropic-max-2")).getByText("reanuda en 30m")).toBeTruthy();
  });

  it("empty accounts => empty state", () => {
    renderAt(<SubscriptionsView snapshot={{ ...snapshotFixture, accounts: [] }} />);
    expect(screen.getByTestId("subs-empty")).toBeTruthy();
  });
});
