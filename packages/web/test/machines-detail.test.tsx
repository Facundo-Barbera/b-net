import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { snapshotFixture, type HubSnapshot } from "@bixku/core";
import { MachinesView } from "../src/views/machines/MachinesView.tsx";
import { groupThreads } from "../src/views/machines/derive.ts";
import { duration, rate, relTime, usedOfTotal } from "../src/views/machines/format.ts";

const NOW = snapshotFixture.generatedAt;
const open = (id: string, snap: HubSnapshot = snapshotFixture) => {
  render(<MachinesView snapshot={snap} now={NOW} />);
  fireEvent.click(screen.getByRole("button", { name: `Show details for ${snap.machines.find((m) => m.id === id)!.name}` }));
  return screen.getByTestId("machine-detail");
};
const group = (panel: HTMLElement, state: string) => panel.querySelector(`section[data-state="${state}"]`) as HTMLElement | null;

describe("machine detail panel", () => {
  it("starts empty and opens/closes on selection", () => {
    render(<MachinesView snapshot={snapshotFixture} now={NOW} />);
    expect(screen.getByTestId("detail-empty")).toBeTruthy();
    expect(screen.queryByTestId("machine-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show details for bixku-vps" }));
    expect(screen.getByTestId("machine-detail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByTestId("detail-empty")).toBeTruthy();
  });

  it("bixku-vps lists its 7 threads in the right state groups", () => {
    const panel = open("bixku-vps");
    expect(panel.querySelectorAll("li[data-testid^='thread-']")).toHaveLength(7);
    const ids = (state: string) =>
      Array.from(group(panel, state)!.querySelectorAll("li[data-testid^='thread-']")).map((n) => n.getAttribute("data-testid"));
    expect(ids("active").sort()).toEqual(["thread-th_01", "thread-th_02"]);
    expect(ids("waiting")).toEqual(["thread-th_03"]);
    expect(ids("idle")).toEqual(["thread-th_04"]);
    expect(ids("dormant").sort()).toEqual(["thread-th_05", "thread-th_06", "thread-th_07"]);
    expect(group(panel, "archived")).toBeNull();
    // thread belonging to another machine does not leak in
    expect(within(panel).queryByText("Facturación CFDI: validaciones")).toBeNull();
    expect(within(panel).getByText("T3 threads · 7")).toBeTruthy();
  });

  it("shows running-since, needs-you, project, provider/model, branch and updated time", () => {
    const panel = open("bixku-vps");
    const th01 = within(panel).getByTestId("thread-th_01");
    expect(within(th01).getAllByText("running 14m").length).toBeGreaterThan(0);
    const th03 = within(panel).getByTestId("thread-th_03");
    expect(within(th03).getByText("needs you")).toBeTruthy();
    expect(within(th03).getByText("dotfiles")).toBeTruthy();
    expect(within(th03).getByText("updated 42m ago")).toBeTruthy();
    const th06 = within(panel).getByTestId("thread-th_06");
    expect(within(th06).getByText("codex · gpt-5.5")).toBeTruthy();
    expect(within(th06).getByText("last run failed")).toBeTruthy();
    expect(within(th06).getByText("updated 2d ago")).toBeTruthy();
    const th04 = within(panel).getByTestId("thread-th_04");
    expect(within(th04).getByText("claudeAgent · claude-sonnet-5-5")).toBeTruthy();
  });

  it("nests subagent threads under their parent and shows the branch", () => {
    const panel = open("bixku-vps");
    const parent = within(panel).getByTestId("thread-th_01");
    const nested = within(parent).getByTestId("thread-th_02");
    expect(within(nested).getByText("⎇ feat/proxy")).toBeTruthy();
    // the child is not also listed at top level of the group
    const topLevel = group(panel, "active")!.querySelectorAll(":scope > ul > li");
    expect(topLevel).toHaveLength(1);
  });

  it("notes the parent when a subagent lives in a different state group", () => {
    const snap: HubSnapshot = structuredClone(snapshotFixture);
    snap.threads.find((t) => t.id === "th_02")!.state = "idle";
    const panel = open("bixku-vps", snap);
    const child = within(group(panel, "idle")!).getByTestId("thread-th_02");
    expect(within(child).getByText(/subagent of “bixku-hub fase 1 \(coordinador\)”/)).toBeTruthy();
  });

  it("hides archived threads behind a toggle", () => {
    const panel = open("bixku-mbp");
    expect(within(panel).getByTestId("thread-th_13")).toBeTruthy();
    expect(within(panel).queryByTestId("thread-th_14")).toBeNull();
    const toggle = within(panel).getByRole("button", { name: "Show archived (1)" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(within(panel).getByTestId("thread-th_14")).toBeTruthy();
    expect(group(panel, "archived")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Hide archived (1)" }));
    expect(within(panel).queryByTestId("thread-th_14")).toBeNull();
  });

  it("warns when the T3 source of the machine is unreachable", () => {
    const panel = open("bixku-mbp");
    const alert = within(panel).getByRole("alert");
    expect(alert.textContent).toMatch(/agent unreachable \(timeout 3s\)/);
    expect(alert.textContent).toMatch(/26h ago/);
    cleanupAndOpen();
    function cleanupAndOpen() {
      // healthy machine has no alert
      fireEvent.click(screen.getByRole("button", { name: "Show details for bixku-vps" }));
      expect(within(screen.getByTestId("machine-detail")).queryByRole("alert")).toBeNull();
    }
  });

  it("renders CPU/RAM sparklines from history, or an explicit empty state", () => {
    const panel = open("pc-bixku");
    const cpu = within(panel).getByRole("img", { name: /^CPU history, last 29 min/ });
    expect(cpu.querySelector("path.mv-spark__line")?.getAttribute("d")).toMatch(/^M0\.0,/);
    expect(within(panel).getByRole("img", { name: /^RAM history/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show details for MBP Omarchy" }));
    const mbp = screen.getByTestId("machine-detail");
    expect(within(mbp).queryByRole("img")).toBeNull();
    expect(within(mbp).getByText(/No metric history \(machine offline\)/)).toBeTruthy();
  });

  it("machine without threads says so", () => {
    const panel = open("bixku-mba");
    expect(within(panel).getByText("No T3 threads on this machine.")).toBeTruthy();
  });
});

describe("derive/format helpers", () => {
  it("groupThreads survives a parent cycle", () => {
    const base = snapshotFixture.threads.find((t) => t.id === "th_01")!;
    const a = { ...base, id: "a", parentThreadId: "b" };
    const b = { ...base, id: "b", parentThreadId: "a" };
    const g = groupThreads([a, b], false);
    expect(g).toHaveLength(1);
    expect(g[0]!.nodes.length).toBeGreaterThan(0);
  });

  it("formats durations, rates, sizes and relative time", () => {
    const now = Date.parse(NOW);
    expect(duration(1_904_400)).toBe("22d 1h");
    expect(duration(51_000)).toBe("14h 10m");
    expect(duration(null)).toBe("—");
    expect(rate(182_000)).toBe("182 KB/s");
    expect(rate(1_240_000)).toBe("1.2 MB/s");
    expect(rate(null)).toBe("—");
    expect(usedOfTotal(5.3, 7.5)).toBe("5.3 / 7.5 GB");
    expect(usedOfTotal(1846, 2000)).toBe("1.8 / 2.0 TB");
    expect(relTime(new Date(now - 5_000).toISOString(), now)).toBe("just now");
    expect(relTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h ago");
    expect(relTime(new Date(now + 5 * 60_000).toISOString(), now)).toBe("in 5m");
    expect(relTime(null, now)).toBe("never");
  });
});
