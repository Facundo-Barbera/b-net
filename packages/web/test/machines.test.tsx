import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { snapshotFixture, type HubSnapshot } from "@b-net/core";
import { MachinesView } from "../src/views/machines/MachinesView.tsx";
import { NOW_MS, renderAt } from "./helpers.tsx";

const renderView = (snapshot: HubSnapshot = snapshotFixture, extra: { initialSelectedId?: string } = {}) =>
  renderAt(<MachinesView snapshot={snapshot} {...extra} />);

const topology = () => screen.getByTestId("topology-svg");
const node = (name: RegExp) => within(topology()).getByRole("button", { name });

afterEach(() => vi.unstubAllGlobals());

describe("MachinesView: overview", () => {
  it("keeps the testid the shell/app test relies on", () => {
    renderView();
    expect(screen.getByTestId("view-machines")).toBeTruthy();
  });

  it("renders all 6 machines as SVG nodes and as cards", () => {
    renderView();
    expect(within(topology()).getAllByRole("button")).toHaveLength(snapshotFixture.machines.length);
    expect(screen.getAllByRole("article")).toHaveLength(6);
    for (const m of snapshotFixture.machines) {
      expect(screen.getByTestId(`card-${m.id}`)).toBeTruthy();
      expect(screen.getByRole("button", { name: `Ver detalle de ${m.name}` })).toBeTruthy();
    }
  });

  it("summary strip: online/total, degraded, offline, sandboxes, worst latency", () => {
    renderView();
    const online = screen.getByTestId("sum-online");
    expect(online.textContent).toContain("5"); // homelab, vps, focaltec, pc (degraded) and MBA (no metrics source)
    expect(online.textContent).toContain("/6");
    expect(online.textContent).toContain("2 sin métricas"); // MBP and MBA
    expect(online.textContent).not.toContain("paused");
    expect(screen.getByTestId("sum-degraded").textContent).toContain("1");
    expect(screen.getByTestId("sum-offline").textContent).toContain("1");
    // awake = active+waiting+idle: vps 4, focaltec 1, pc 1 = 6; dormant: 3+2+1+1 = 7
    expect(within(screen.getByTestId("sum-awake")).getByText("6")).toBeTruthy();
    expect(within(screen.getByTestId("sum-dormant")).getByText("7")).toBeTruthy();
    const worst = screen.getByTestId("sum-latency");
    expect(worst.textContent).toContain("148 ms");
    expect(worst.textContent).toContain("bixku-vps");
  });

  it("computes relative times against the injected now", () => {
    const { unmount } = renderView();
    const mbp = screen.getByTestId("card-bixku-mbp");
    expect(within(mbp).getByText("hace 1d 2h")).toBeTruthy(); // last seen 26h before generatedAt
    unmount();
    // a different now shifts the label
    renderAt(<MachinesView snapshot={snapshotFixture} />, NOW_MS + 3 * 86_400_000);
    expect(within(screen.getByTestId("card-bixku-mbp")).getByText("hace 4d 2h")).toBeTruthy();
  });
});

describe("MachinesView: machine states", () => {
  it("PC-BiXKu is degraded, over DERP relay mia, with danger meters", () => {
    renderView();
    expect(screen.getByTestId("status-pc-bixku").textContent).toBe("Degraded");
    const n = node(/^PC-BiXKu/);
    expect(n.getAttribute("aria-label")).toMatch(/degraded/);
    expect(n.getAttribute("aria-label")).toMatch(/87 ms · DERP mia/);
    expect(within(topology()).getByText("87 ms · DERP mia")).toBeTruthy();
    const card = screen.getByTestId("card-pc-bixku");
    const cpu = within(card).getByRole("meter", { name: "CPU" });
    expect(cpu.getAttribute("aria-valuenow")).toBe("92");
    expect(cpu.closest(".ui-meter")?.getAttribute("data-tone")).toBe("danger"); // 91.5 > 90
    expect(within(card).getByRole("meter", { name: "RAM" }).closest(".ui-meter")?.getAttribute("data-tone")).toBe("warn"); // 88.7
    expect(within(card).getByRole("meter", { name: "Disco" }).closest(".ui-meter")?.getAttribute("data-tone")).toBe("danger"); // 92.3
    // thresholds also read as words, not only as color
    expect(within(card).getAllByText("CRIT")).toHaveLength(2);
    expect(within(card).getByText("HIGH")).toBeTruthy();
    expect(within(card).getByText("78 °C · alta")).toBeTruthy();
    expect(within(card).getByText(/agent · hace 1m/)).toBeTruthy();
    // status badge carries a shape (warn = triangle) next to the word
    expect(screen.getByTestId("status-pc-bixku").querySelector("svg")?.getAttribute("data-shape")).toBe("triangle");
  });

  it("healthy machines get ok-level meters", () => {
    renderView();
    const card = screen.getByTestId("card-bixku-focaltec");
    expect(within(card).getByRole("meter", { name: "CPU" }).closest(".ui-meter")?.getAttribute("data-tone")).toBe("ok");
    expect(within(card).getByRole("meter", { name: "Disco" }).closest(".ui-meter")?.getAttribute("data-tone")).toBe("warn"); // 71 >= shared USAGE_WARN_AT (70); the old local threshold was 75
  });

  it("MBP is offline with no metrics and a faded link", () => {
    renderView();
    expect(screen.getByTestId("status-bixku-mbp").textContent).toBe("Offline");
    const card = screen.getByTestId("card-bixku-mbp");
    expect(within(card).queryAllByRole("meter")).toHaveLength(0);
    expect(within(card).getByText("Offline: sin métricas")).toBeTruthy();
    expect(within(card).getByText("sin métricas")).toBeTruthy(); // no metrics source tag
    expect(node(/^MBP Omarchy/).getAttribute("aria-label")).toMatch(/offline.*sin métricas/);
    const link = topology().querySelector('[data-link-for="bixku-mbp"]');
    expect(link?.getAttribute("data-kind")).toBe("offline");
    expect(link?.textContent).toBe("offline");
  });

  it("MBA is online without a metrics source (not paused), says which source is missing, peer-relay link", () => {
    renderView();
    expect(screen.getByTestId("status-bixku-mba").textContent).toBe("Online");
    const card = screen.getByTestId("card-bixku-mba");
    expect(within(card).queryAllByRole("meter")).toHaveLength(0);
    // Beszel is connected in the fixture, so the reason is that MBA is not in it and has no agent.
    expect(within(card).getByTestId("note-bixku-mba").textContent).toContain("Sin fuente de métricas: no está en Beszel · sin agente");
    expect(within(card).getByTestId("note-bixku-mba").textContent).toMatch(/beszelName.*agentUrl/);
    expect(within(card).getByText("Sin agente ni Beszel todavía.")).toBeTruthy();
    expect(node(/^MBA/).getAttribute("aria-label")).toMatch(/^MBA: online, enlace 34 ms · peer relay, sin métricas/);
    const link = topology().querySelector('[data-link-for="bixku-mba"]');
    expect(link?.getAttribute("data-kind")).toBe("peer-relay");
    expect(link?.textContent).toBe("34 ms · peer relay");
  });

  it("paused only means paused in Beszel, and reads differently from 'no metrics source'", () => {
    const snap: HubSnapshot = structuredClone(snapshotFixture);
    const homelab = snap.machines.find((m) => m.id === "bixku-homelab")!;
    homelab.status = "paused";
    renderView(snap);
    expect(screen.getByTestId("status-bixku-homelab").textContent).toBe("Paused");
    expect(screen.getByTestId("status-bixku-homelab").querySelector("svg")?.getAttribute("data-shape")).toBe("pause");
    expect(within(screen.getByTestId("card-bixku-homelab")).getByText("Pausada en Beszel: últimos valores conocidos")).toBeTruthy();
  });

  it("with Beszel not connected, the coverage notice and the cards name Beszel as the missing source", () => {
    const snap: HubSnapshot = { ...snapshotFixture, sources: snapshotFixture.sources.filter((s) => s.source !== "beszel") };
    renderView(snap);
    const notice = screen.getByTestId("metrics-coverage");
    expect(notice.textContent).toContain("2 de 6 máquinas sin fuente de métricas");
    expect(notice.textContent).toContain("Beszel: no conectado");
    expect(notice.textContent).toContain("BESZEL_URL");
    expect(within(screen.getByTestId("card-bixku-mba")).getByTestId("note-bixku-mba").textContent).toContain("Beszel no está conectado al hub");
  });

  it("no coverage notice when every machine has a metrics source", () => {
    const snap: HubSnapshot = structuredClone(snapshotFixture);
    for (const m of snap.machines) m.metricsSource = m.metricsSource === "none" ? "agent" : m.metricsSource;
    renderView(snap);
    expect(screen.queryByTestId("metrics-coverage")).toBeNull();
  });

  it("shows latency labels on every non-hub link, styled by path", () => {
    renderView();
    const t = topology();
    const expected: Record<string, [string, string]> = {
      "bixku-vps": ["direct", "148 ms · directo"],
      "bixku-focaltec": ["direct", "12 ms · directo"],
      "pc-bixku": ["derp", "87 ms · DERP mia"],
      "bixku-mba": ["peer-relay", "34 ms · peer relay"],
      "bixku-mbp": ["offline", "offline"],
    };
    for (const [id, [kind, text]] of Object.entries(expected)) {
      const link = t.querySelector(`[data-link-for="${id}"]`);
      expect(link?.getAttribute("data-kind")).toBe(kind);
      expect(link?.textContent).toBe(text);
    }
    expect(t.querySelector('[data-link-for="bixku-homelab"]')).toBeNull(); // hub has no link to itself
  });

  it("marks the hub and shows services with up/down status", () => {
    renderView();
    const hub = screen.getByTestId("card-bixku-homelab");
    expect(within(hub).getByText("HUB")).toBeTruthy();
    const list = within(hub).getByRole("list", { name: "Servicios de bixku-homelab" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).getByText(":8318")).toBeTruthy();
  });

  it("flags stale metrics and down services", () => {
    const snap: HubSnapshot = structuredClone(snapshotFixture);
    const vps = snap.machines.find((m) => m.id === "bixku-vps")!;
    vps.metricsAt = new Date(NOW_MS - 20 * 60_000).toISOString();
    vps.services = [{ name: "sshd", port: 22, status: "down" }];
    renderView(snap);
    const card = screen.getByTestId("card-bixku-vps");
    expect(within(card).getByText(/\(desactualizadas\)/)).toBeTruthy();
    expect(within(card).getByText(/Servicios · 1 down/)).toBeTruthy();
  });
});

describe("MachinesView: accessibility of the map", () => {
  it("every SVG node is a labelled, focusable button", () => {
    renderView();
    const nodes = within(topology()).getAllByRole("button");
    for (const n of nodes) {
      expect(n.getAttribute("aria-label")).toBeTruthy();
      expect(n.getAttribute("tabindex")).toBe("0");
      expect(n.getAttribute("aria-pressed")).toBe("false");
    }
    expect(topology().getAttribute("aria-label")).toBe("Topología de máquinas");
    expect(node(/^bixku-homelab \(hub\)/).getAttribute("aria-label")).toMatch(/0 sandboxes activos y 0 dormidos/);
    expect(node(/^bixku-vps/).getAttribute("aria-label")).toMatch(/enlace 148 ms · directo.*CPU 62%, RAM 54%.*4 sandboxes activos y 3 dormidos/);
  });

  it("hover/focus highlights the link; click and keyboard select", () => {
    renderView();
    const link = () => topology().querySelector('[data-link-for="bixku-vps"]')!;
    expect(link().hasAttribute("data-active")).toBe(false);
    const vps = node(/^bixku-vps/);
    fireEvent.mouseEnter(vps);
    expect(link().hasAttribute("data-active")).toBe(true);
    fireEvent.mouseLeave(vps);
    expect(link().hasAttribute("data-active")).toBe(false);
    fireEvent.focus(vps);
    expect(link().hasAttribute("data-active")).toBe(true);
    fireEvent.blur(vps);

    fireEvent.keyDown(node(/^pc-bixku|^PC-BiXKu/), { key: "Enter" });
    expect(screen.getByTestId("machine-detail").getAttribute("data-machine")).toBe("pc-bixku");
    expect(node(/^PC-BiXKu/).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(node(/^bixku-vps/), { key: " " });
    expect(screen.getByTestId("machine-detail").getAttribute("data-machine")).toBe("bixku-vps");
  });

  it("falls back to a stacked list on narrow screens", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
    }));
    renderView();
    expect(screen.queryByTestId("topology-svg")).toBeNull();
    const list = screen.getByTestId("topology-list");
    expect(within(list).getAllByRole("button")).toHaveLength(6);
    expect(within(list).getByText("87 ms · DERP mia")).toBeTruthy();
    fireEvent.click(within(list).getByRole("button", { name: /^bixku-vps/ }));
    expect(screen.getByTestId("machine-detail").getAttribute("data-machine")).toBe("bixku-vps");
  });
});
