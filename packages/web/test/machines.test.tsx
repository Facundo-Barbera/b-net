import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { snapshotFixture, type HubSnapshot } from "@bixku/core";
import { MachinesView } from "../src/views/machines/MachinesView.tsx";

/** generatedAt === FIXTURE_NOW in the canonical fixture. */
const NOW = snapshotFixture.generatedAt;

const renderView = (snapshot: HubSnapshot = snapshotFixture, extra: { initialSelectedId?: string } = {}) =>
  render(<MachinesView snapshot={snapshot} now={NOW} {...extra} />);

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
      expect(screen.getByRole("button", { name: `Show details for ${m.name}` })).toBeTruthy();
    }
  });

  it("summary strip: online/total, degraded, offline, sandboxes, worst latency", () => {
    renderView();
    const online = screen.getByTestId("sum-online");
    expect(online.textContent).toContain("4");
    expect(online.textContent).toContain("/6");
    expect(online.textContent).toContain("1 paused");
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
    renderView();
    expect(screen.getByText(/snapshot just now/)).toBeTruthy();
    const mbp = screen.getByTestId("card-bixku-mbp");
    expect(within(mbp).getByText("26h ago")).toBeTruthy(); // last seen
    // a different now shifts the label
    const later = new Date(Date.parse(NOW) + 3 * 86_400_000);
    const { container } = render(<MachinesView snapshot={snapshotFixture} now={later} />);
    expect(container.textContent).toContain("snapshot 3d ago");
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
    expect(cpu.closest(".mv-meter")?.getAttribute("data-level")).toBe("danger"); // 91.5 > 90
    expect(within(card).getByRole("meter", { name: "RAM" }).closest(".mv-meter")?.getAttribute("data-level")).toBe("warn"); // 88.7
    expect(within(card).getByRole("meter", { name: "Disk" }).closest(".mv-meter")?.getAttribute("data-level")).toBe("danger"); // 92.3
    expect(within(card).getByText(/agent · 1m ago/)).toBeTruthy();
  });

  it("healthy machines get ok-level meters", () => {
    renderView();
    const card = screen.getByTestId("card-bixku-focaltec");
    expect(within(card).getByRole("meter", { name: "CPU" }).closest(".mv-meter")?.getAttribute("data-level")).toBe("ok");
    expect(within(card).getByRole("meter", { name: "Disk" }).closest(".mv-meter")?.getAttribute("data-level")).toBe("ok"); // 71
  });

  it("MBP is offline with no metrics and a faded link", () => {
    renderView();
    expect(screen.getByTestId("status-bixku-mbp").textContent).toBe("Offline");
    const card = screen.getByTestId("card-bixku-mbp");
    expect(within(card).queryAllByRole("meter")).toHaveLength(0);
    expect(within(card).getByText(/Offline: no metrics/)).toBeTruthy();
    expect(within(card).getByText("none")).toBeTruthy(); // metrics source
    expect(node(/^MBP Omarchy/).getAttribute("aria-label")).toMatch(/offline.*no metrics/);
    const link = topology().querySelector('[data-link-for="bixku-mbp"]');
    expect(link?.getAttribute("data-kind")).toBe("offline");
    expect(link?.textContent).toBe("offline");
  });

  it("MBA is paused with no metrics source and a peer-relay link", () => {
    renderView();
    expect(screen.getByTestId("status-bixku-mba").textContent).toBe("Paused");
    const card = screen.getByTestId("card-bixku-mba");
    expect(within(card).getByText(/Paused: no metrics collected/)).toBeTruthy();
    expect(within(card).getByText("Sin agente ni Beszel todavía.")).toBeTruthy();
    const link = topology().querySelector('[data-link-for="bixku-mba"]');
    expect(link?.getAttribute("data-kind")).toBe("peer-relay");
    expect(link?.textContent).toBe("34 ms · peer relay");
  });

  it("shows latency labels on every non-hub link, styled by path", () => {
    renderView();
    const t = topology();
    const expected: Record<string, [string, string]> = {
      "bixku-vps": ["direct", "148 ms"],
      "bixku-focaltec": ["direct", "12 ms"],
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
    const list = within(hub).getByRole("list", { name: "bixku-homelab services" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).getByText(":8318")).toBeTruthy();
  });

  it("flags stale metrics and down services", () => {
    const snap: HubSnapshot = structuredClone(snapshotFixture);
    const vps = snap.machines.find((m) => m.id === "bixku-vps")!;
    vps.metricsAt = new Date(Date.parse(NOW) - 20 * 60_000).toISOString();
    vps.services = [{ name: "sshd", port: 22, status: "down" }];
    renderView(snap);
    const card = screen.getByTestId("card-bixku-vps");
    expect(within(card).getByText(/\(stale\)/)).toBeTruthy();
    expect(within(card).getByText(/Services · 1 down/)).toBeTruthy();
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
    expect(topology().getAttribute("aria-label")).toBe("Machine topology");
    expect(node(/^bixku-homelab \(hub\)/).getAttribute("aria-label")).toMatch(/0 awake and 0 dormant/);
    expect(node(/^bixku-vps/).getAttribute("aria-label")).toMatch(/link 148 ms.*CPU 62%, RAM 54%.*4 awake and 3 dormant sandboxes/);
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
