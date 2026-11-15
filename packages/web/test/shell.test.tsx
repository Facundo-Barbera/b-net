import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { snapshotFixture, type HubSnapshot } from "@b-net/core";
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
  it("renders brand, one nav link per route and defaults to machines", () => {
    render(<App mode="fixture" />);
    expect(document.querySelector(".sh-brand__name")?.textContent).toBe("b-net");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(routes.length);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(routes.map((r) => r.path));
    expect(screen.getByTestId("view-machines")).toBeTruthy();
    expect(screen.getByTestId("page-title").textContent).toBe("Machines");
  });

  it("marks only the active link with aria-current and follows hashchange", async () => {
    render(<App mode="fixture" />);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const current = () => within(nav).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current().map((l) => l.getAttribute("href"))).toEqual(["#/machines"]);

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

  it("falls back to machines for an unknown hash and rewrites it", () => {
    location.hash = "#/does-not-exist";
    render(<App mode="fixture" />);
    expect(screen.getByTestId("view-machines")).toBeTruthy();
    expect(location.hash).toBe("#/machines");
  });

  it("resolveRoute handles sub-paths, queries and empty hashes", () => {
    expect(resolveRoute("").id).toBe("machines");
    expect(resolveRoute("#/subscriptions").id).toBe("subscriptions");
    expect(resolveRoute("#/proxy/records").id).toBe("proxy");
    expect(resolveRoute("#/secrets?x=1").id).toBe("secrets");
    expect(resolveRoute("#/proxyfoo").id).toBe("machines");
  });

  it("skip link focuses <main> without changing the hash", () => {
    location.hash = "#/proxy";
    render(<App mode="fixture" />);
    fireEvent.click(screen.getByText("Skip to content"));
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
    expect(gen.textContent).toContain("just now");
    expect(gen.querySelector("time")?.getAttribute("dateTime")).toBe(snapshotFixture.generatedAt);
  });

  it("shows loading, then an error state in live mode when the hub is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    render(<App mode="live" />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("boom");
    expect(screen.getByTestId("data-mode").textContent).toContain("live");
  });
});

describe("theme toggle", () => {
  const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

  it("sets data-theme on <html>, persists it and reflects aria-pressed", () => {
    render(<App mode="fixture" />);
    // jsdom has no matchMedia → "system" resolves to dark.
    expect(theme()).toBe("dark");
    expect(screen.getByRole("button", { name: "System theme" }).getAttribute("aria-pressed")).toBe("true");

    press("Light theme");
    expect(theme()).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(screen.getByRole("button", { name: "Light theme" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "System theme" }).getAttribute("aria-pressed")).toBe("false");

    press("Dark theme");
    expect(theme()).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("restores the stored preference on mount", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    render(<App mode="fixture" />);
    expect(theme()).toBe("light");
    expect(screen.getByRole("button", { name: "Light theme" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("follows the OS preference in system mode", () => {
    window.matchMedia = ((q: string) => ({
      matches: q.includes("light"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    render(<App mode="fixture" />);
    expect(theme()).toBe("light");
    press("Dark theme");
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
    expect(() => press("Light theme")).not.toThrow();
    expect(theme()).toBe("light");
    expect(screen.getByRole("button", { name: "Light theme" }).getAttribute("aria-pressed")).toBe("true");
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
      expect(() => press("Light theme")).not.toThrow();
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
    expect(items[0]!.getAttribute("data-ok")).toBe("false");
    expect(items[0]!.textContent).toContain("t3 · bixku-mbp");
    expect(items[0]!.getAttribute("title")).toContain("agent unreachable");
    expect(within(items[0]!).getByRole("img", { name: "error" })).toBeTruthy();
    expect(items.filter((i) => i.getAttribute("data-ok") === "true")).toHaveLength(6);
    expect(screen.getByTestId("sources-summary").textContent).toBe("6/7");
    expect(within(items[1]!).getByRole("img", { name: "ok" })).toBeTruthy();
    // lastSuccessAt rendered relative to the snapshot time
    expect(items.at(-1)!.textContent).toMatch(/just now|\ds ago/);
    expect(items[0]!.textContent).toContain("1d ago");
  });
});

describe("nav badges", () => {
  it("derives counts from the fixture", () => {
    expect(deriveNavBadges(snapshotFixture)).toEqual({
      machines: { count: 1, tone: "danger", label: "offline" },
      subscriptions: { count: 1, tone: "warn", label: "in cooldown" },
      proxy: { count: 4, tone: "warn", label: "errors in the last hour" },
      secrets: { count: 1, tone: "warn", label: "expiring" },
    });
  });

  it("renders them in the sidebar with accessible text", () => {
    render(<App mode="fixture" />);
    expect(screen.getByTestId("nav-badge-machines").textContent).toContain("1");
    expect(screen.getByTestId("nav-badge-machines").className).toContain("tone-danger");
    expect(screen.getByTestId("nav-badge-subscriptions").className).toContain("tone-warn");
    expect(screen.getByTestId("nav-badge-proxy").textContent).toContain("4");
    expect(screen.getByRole("link", { name: /Machines.*1 offline/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Secrets.*1 expiring/ })).toBeTruthy();
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
    const toggle = screen.getByRole("button", { name: "Toggle navigation" });
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
    fireEvent.click(screen.getByRole("link", { name: /Secrets/ }));
    expect(sidebar.getAttribute("data-open")).toBe("false");
  });
});
