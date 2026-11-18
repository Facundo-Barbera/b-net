import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { snapshotFixture, workFixture, type HubSnapshot } from "@b-net/core";
import { App } from "../src/shell/App.tsx";
import { deriveNavBadges } from "../src/shell/badges.ts";
import { resolveRoute } from "../src/shell/useHashRoute.ts";
import { THEME_STORAGE_KEY } from "../src/lib/theme.ts";
import { routes } from "../src/routes.tsx";

function resetEnvironment() {
  history.replaceState(null, "", "/");
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.title = "";
}

beforeEach(resetEnvironment);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  // Remove the matchMedia stub installed by a test (jsdom has none).
  delete (window as unknown as Record<string, unknown>).matchMedia;
  resetEnvironment();
});

const theme = () => document.documentElement.getAttribute("data-theme");

describe("shell navigation", () => {
  it("renders brand, one nav link per route and defaults to work", () => {
    render(<App mode="fixture" />);
    expect(document.querySelector(".sh-brand__name")?.textContent).toBe("b-net");
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(routes.length);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(routes.map((r) => r.path));
    expect(screen.getByTestId("view-work")).toBeTruthy();
    expect(screen.getByTestId("page-title").textContent).toBe("Trabajo");
  });

  it("marks only the active link with aria-current and follows hashchange", async () => {
    render(<App mode="fixture" />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    const current = () => within(nav).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current().map((l) => l.getAttribute("href"))).toEqual(["#/work"]);

    act(() => {
      location.hash = "#/proxy";
    });
    expect(await screen.findByTestId("view-proxy")).toBeTruthy();
    expect(current().map((l) => l.getAttribute("href"))).toEqual(["#/proxy"]);
    expect(screen.getByTestId("page-title").textContent).toBe("Proxy");
    expect(document.title).toBe("Proxy · b-net");

    act(() => {
      location.hash = "#/secrets";
    });
    expect(await screen.findByTestId("view-secrets")).toBeTruthy();
  });

  it("falls back to work for an unknown hash and rewrites it", () => {
    location.hash = "#/does-not-exist";
    render(<App mode="fixture" />);
    expect(screen.getByTestId("view-work")).toBeTruthy();
    expect(location.hash).toBe("#/work");
  });

  it("resolveRoute handles sub-paths, queries and empty hashes", () => {
    expect(resolveRoute("").id).toBe("work");
    expect(resolveRoute("#/projects/b-net/d/x").id).toBe("projects");
    expect(resolveRoute("#/subscriptions").id).toBe("subscriptions");
    expect(resolveRoute("#/proxy/records").id).toBe("proxy");
    expect(resolveRoute("#/secrets?x=1").id).toBe("secrets");
    expect(resolveRoute("#/proxyfoo").id).toBe("work");
  });

  it("skip link focuses <main> without changing the hash", () => {
    location.hash = "#/proxy";
    render(<App mode="fixture" />);
    fireEvent.click(screen.getByText("Saltar al contenido"));
    expect(document.activeElement).toBe(screen.getByRole("main"));
    expect(location.hash).toBe("#/proxy");
  });
});

describe("shell top bar", () => {
  it("shows the data mode and freshness of the snapshot", () => {
    render(<App mode="fixture" />);
    expect(screen.getByTestId("data-mode").textContent).toContain("fixture");
    const gen = screen.getByTestId("generated-at");
    // Fixture mode computes relative time against generatedAt, so it reads as fresh.
    expect(gen.textContent).toContain("hace <1m");
    expect(gen.querySelector("time")?.getAttribute("dateTime")).toBe(snapshotFixture.generatedAt);
  });

  it("shows loading, then an error state in live mode when the hub is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    render(<App mode="live" />);
    expect(screen.getByRole("status").textContent).toContain("Cargando");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("boom");
    // says what to check, and how to see the UI without a hub
    expect(alert.textContent).toContain("WEB_HUB_URL");
    expect(alert.textContent).toContain("?data=fixture");
    expect(screen.getByTestId("data-mode").textContent).toContain("live");
  });
});

describe("theme toggle", () => {
  const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

  it("sets data-theme on <html>, persists it and reflects aria-pressed", () => {
    render(<App mode="fixture" />);
    // Dark is the default preference (not "follow the system").
    expect(theme()).toBe("dark");
    expect(screen.getByRole("button", { name: "Tema oscuro" }).getAttribute("aria-pressed")).toBe("true");

    press("Tema claro");
    expect(theme()).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.getByRole("button", { name: "Tema claro" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Tema oscuro" }).getAttribute("aria-pressed")).toBe("false");

    press("Tema oscuro");
    expect(theme()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("restores the stored preference on mount", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<App mode="fixture" />);
    expect(theme()).toBe("light");
    expect(screen.getByRole("button", { name: "Tema claro" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("follows the OS preference in system mode", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    window.matchMedia = ((q: string) => ({
      matches: q.includes("light"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    render(<App mode="fixture" />);
    expect(theme()).toBe("light");
    press("Tema oscuro");
    expect(theme()).toBe("dark");
  });

  it("survives localStorage methods that throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    render(<App mode="fixture" />);
    expect(theme()).toBe("dark");
    expect(() => press("Tema claro")).not.toThrow();
    expect(theme()).toBe("light");
    expect(screen.getByRole("button", { name: "Tema claro" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("survives an inaccessible localStorage object", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      render(<App mode="fixture" />);
      expect(() => press("Tema claro")).not.toThrow();
      expect(theme()).toBe("light");
    } finally {
      Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("source health", () => {
  it("lists every snapshot source, failing first, with the error as tooltip", () => {
    render(<App mode="fixture" />);
    const items = screen.getAllByTestId("source-item");
    expect(items).toHaveLength(snapshotFixture.sources.length);
    expect(items[0]!.getAttribute("data-state")).toBe("failing");
    expect(items[0]!.textContent).toContain("t3 · bixku-mbp");
    expect(items[0]!.getAttribute("title")).toContain("agent unreachable");
    expect(within(items[0]!).getByRole("img", { name: "con error" }).getAttribute("data-shape")).toBe("square");
    expect(items.filter((i) => i.getAttribute("data-state") === "ok")).toHaveLength(6);
    expect(screen.getByTestId("sources-summary").textContent).toBe("6/7");
    expect(within(items[1]!).getByRole("img", { name: "ok" }).getAttribute("data-shape")).toBe("circle");
    // lastSuccessAt rendered relative to the snapshot time
    expect(items.at(-1)!.textContent).toContain("hace <1m");
    expect(items[0]!.textContent).toContain("hace 1d 2h");
  });

  it("lists core sources the hub has not configured as 'sin conectar', with how to connect them", async () => {
    const snap = { ...snapshotFixture, sources: snapshotFixture.sources.filter((s) => s.source !== "beszel" && s.source !== "proxy") };
    location.hash = "#/machines";
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url === "/api/v1/work" ? workFixture : snap), { status: 200 }))));
    render(<App mode="live" />);
    // Before the first snapshot every core source reads "sin conectar"; wait for the loaded one.
    await screen.findByTestId("view-machines");
    const missing = screen.getAllByTestId("source-item").filter((i) => i.getAttribute("data-state") === "missing");
    expect(missing.map((i) => i.textContent)).toEqual(["beszelsin conectar", "proxysin conectar"]);
    expect(missing[0]!.getAttribute("title")).toContain("BESZEL_URL");
    expect(within(missing[0]!).getByRole("img", { name: "sin conectar" }).getAttribute("data-shape")).toBe("ring");
    expect(screen.getByTestId("sources-summary").textContent).toBe("4/7");
  });
});

describe("nav badges", () => {
  it("derives counts from the fixture", () => {
    expect(deriveNavBadges(snapshotFixture)).toEqual({
      machines: { count: 1, tone: "danger", label: "offline" },
      subscriptions: { count: 1, tone: "warn", label: "en cooldown" },
      proxy: { count: 4, tone: "warn", label: "errores en la última hora" },
      secrets: { count: 1, tone: "warn", label: "por vencer" },
    });
  });

  it("renders them in the sidebar with accessible text", () => {
    render(<App mode="fixture" />);
    expect(screen.getByTestId("nav-badge-machines").textContent).toContain("1");
    expect(screen.getByTestId("nav-badge-machines").className).toContain("tone-danger");
    expect(screen.getByTestId("nav-badge-subscriptions").className).toContain("tone-warn");
    expect(screen.getByTestId("nav-badge-proxy").textContent).toContain("4");
    expect(screen.getByRole("link", { name: /Máquinas.*1 offline/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Secretos.*1 por vencer/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Trabajo.*te esperan/ })).toBeTruthy();
  });

  it("escalates tones and omits badges when everything is fine", () => {
    const bad = structuredClone(snapshotFixture) as HubSnapshot;
    bad.accounts[0]!.poolState = "error";
    bad.secrets[0]!.status = "expired";
    const b = deriveNavBadges(bad);
    expect(b.subscriptions).toMatchObject({ count: 2, tone: "danger" });
    expect(b.secrets).toMatchObject({ count: 2, tone: "danger" });

    const healthy = structuredClone(snapshotFixture) as HubSnapshot;
    healthy.machines.forEach((m) => (m.status = "online"));
    healthy.accounts.forEach((a) => (a.poolState = "active"));
    healthy.secrets.forEach((s) => (s.status = "ok"));
    healthy.proxy!.lastHour.errors = 0;
    expect(deriveNavBadges(healthy)).toEqual({});

    const degradedOnly = structuredClone(healthy) as HubSnapshot;
    degradedOnly.machines[0]!.status = "degraded";
    expect(deriveNavBadges(degradedOnly).machines).toEqual({ count: 1, tone: "warn", label: "degraded" });

    expect(deriveNavBadges(null)).toEqual({});
  });
});

describe("responsive drawer", () => {
  it("toggles with the menu button, Escape and navigation", () => {
    render(<App mode="fixture" />);
    const toggle = screen.getByRole("button", { name: "Mostrar u ocultar la navegación" });
    const sidebar = document.getElementById("sh-sidebar")!;
    expect(sidebar.getAttribute("data-open")).toBe("false");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(sidebar.getAttribute("data-open")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("drawer-backdrop")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(sidebar.getAttribute("data-open")).toBe("false");

    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(sidebar.getAttribute("data-open")).toBe("false");

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("link", { name: /Secretos/ }));
    expect(sidebar.getAttribute("data-open")).toBe("false");
  });
});
