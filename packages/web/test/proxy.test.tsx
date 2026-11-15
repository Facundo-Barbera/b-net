import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { snapshotFixture } from "@b-net/core";
import type { HubSnapshot } from "@b-net/core";
import { ProxyView } from "../src/views/proxy/ProxyView.tsx";
import { renderAt } from "./helpers.tsx";

describe("ProxyView", () => {
  it("renders the status header with version, listen, uptime and the legacy side-by-side note", () => {
    renderAt(<ProxyView snapshot={snapshotFixture} />);
    const s = within(screen.getByTestId("proxy-status"));
    expect(s.getByText("v0.1.0")).toBeTruthy();
    expect(s.getByText("100.64.0.10:8318")).toBeTruthy();
    expect(s.getByText("2d 0h")).toBeTruthy();
    const legacy = within(screen.getByTestId("proxy-legacy"));
    expect(legacy.getByText("CLIProxyAPI")).toBeTruthy();
    expect(legacy.getByText("en paralelo")).toBeTruthy();
    expect(legacy.getByText(/junto a b-net-proxy/)).toBeTruthy();
    expect(legacy.getByText(/aprobación explícita/)).toBeTruthy();
  });

  it("marks legacy as retired when configured", () => {
    const snap: HubSnapshot = {
      ...snapshotFixture,
      proxy: { ...snapshotFixture.proxy!, legacyProxy: { ...snapshotFixture.proxy!.legacyProxy, retired: true } },
    };
    renderAt(<ProxyView snapshot={snap} />);
    expect(within(screen.getByTestId("proxy-legacy")).getByText("retirado")).toBeTruthy();
  });

  it("shows last-hour KPIs", () => {
    renderAt(<ProxyView snapshot={snapshotFixture} />);
    const k = within(screen.getByTestId("proxy-kpis"));
    expect(k.getByText("236")).toBeTruthy();
    expect(k.getByText("1.7% de los requests")).toBeTruthy();
    expect(k.getByText("6.4 s")).toBeTruthy();
    expect(k.getByText("41 s")).toBeTruthy();
    expect(k.getByText("$38.90")).toBeTruthy();
    expect(k.getByText("Rate-limited").nextSibling?.textContent).toBe("3");
    expect(k.getByText("Failovers").nextSibling?.textContent).toBe("2");
  });

  it("lists routes with upstream model and account chain", () => {
    renderAt(<ProxyView snapshot={snapshotFixture} />);
    const claude = within(screen.getByTestId("route-claude-*"));
    expect(claude.getByText("anthropic-max-1")).toBeTruthy();
    expect(claude.getByText("anthropic-max-2")).toBeTruthy();
    expect(claude.getByText("anthropic-api-1")).toBeTruthy();
    const opus = within(screen.getByTestId("route-opus"));
    expect(opus.getByText("claude-opus-5-5")).toBeTruthy();
    expect(opus.getByText("todas las cuentas de anthropic")).toBeTruthy();
  });

  it("shows each client's migration state and overall progress", () => {
    renderAt(<ProxyView snapshot={snapshotFixture} />);
    expect(within(screen.getByTestId("client-t3-vps")).getByText("b-net-proxy")).toBeTruthy();
    expect(within(screen.getByTestId("client-opencode-mbp")).getByText("En paralelo")).toBeTruthy();
    expect(within(screen.getByTestId("client-bot-telegram")).getByText("CLIProxyAPI")).toBeTruthy();
    expect(screen.getByTestId("migration-count").textContent).toBe("1 de 3 migrados");
    expect(screen.getByTestId("migration-note").textContent).toMatch(/rollback/);
    expect(within(screen.getByTestId("client-opencode-mbp")).getByText("claude-*")).toBeTruthy();
  });

  it("flags readiness to retire CLIProxyAPI only when every client is migrated", () => {
    const proxy = snapshotFixture.proxy!;
    const snap: HubSnapshot = { ...snapshotFixture, proxy: { ...proxy, clients: proxy.clients.map((c) => ({ ...c, migration: "b-net-proxy" as const })) } };
    renderAt(<ProxyView snapshot={snap} />);
    expect(screen.getByTestId("migration-count").textContent).toBe("3 de 3 migrados");
    expect(screen.getByTestId("migration-note").textContent).toMatch(/Todos los clientes/);
  });

  it("renders the 12 recent requests incl. the 429 rate-limited row and the failover chain", () => {
    renderAt(<ProxyView snapshot={snapshotFixture} />);
    const rows = screen.getAllByTestId("recent-row");
    expect(rows).toHaveLength(12);

    const limited = rows.filter((r) => within(r).queryByText("rate-limited"));
    expect(limited).toHaveLength(1);
    expect(within(limited[0]!).getByText("429")).toBeTruthy();

    const chains = screen.getAllByTestId("failover-chain");
    expect(chains).toHaveLength(1);
    expect(chains[0]!.textContent).toBe("anthropic-max-2→anthropic-max-1");

    // first row: newest request, 12 s old, anthropic opus via t3-vps
    const first = within(rows[0]!);
    expect(first.getByText("t3-vps")).toBeTruthy();
    expect(first.getByText("Anthropic messages")).toBeTruthy();
    expect(first.getByText("hace 12s")).toBeTruthy();
    expect(first.getByText("$0.02")).toBeTruthy();
    // openai row exposes format
    expect(rows.some((r) => within(r).queryByText("OpenAI responses"))).toBe(true);
  });

  it("recent table has headers for time, client, format, model, account, status, tokens, cost, duration and failover", () => {
    renderAt(<ProxyView snapshot={snapshotFixture} />);
    const t = within(screen.getByTestId("recent-table"));
    for (const h of ["Hora", "Cliente", "Formato", "Modelo", "Cuenta", "Estado", "Costo", "Duración / TTFT", "Failover"]) {
      expect(t.getByRole("columnheader", { name: h })).toBeTruthy();
    }
  });

  it("null proxy => empty state, no tables", () => {
    renderAt(<ProxyView snapshot={{ ...snapshotFixture, proxy: null }} />);
    expect(screen.getByTestId("view-proxy")).toBeTruthy();
    expect(screen.getByTestId("proxy-empty")).toBeTruthy();
    expect(screen.queryByTestId("recent-table")).toBeNull();
    expect(screen.queryByTestId("proxy-status")).toBeNull();
  });

  it("null proxy surfaces the source error when the hub reports one", () => {
    const snap: HubSnapshot = {
      ...snapshotFixture,
      proxy: null,
      sources: snapshotFixture.sources.map((s) => (s.source === "proxy" ? { ...s, ok: false, error: "connect ECONNREFUSED 100.64.0.10:8318" } : s)),
    };
    renderAt(<ProxyView snapshot={snap} />);
    expect(within(screen.getByTestId("proxy-empty")).getByText(/ECONNREFUSED/)).toBeTruthy();
  });
});
