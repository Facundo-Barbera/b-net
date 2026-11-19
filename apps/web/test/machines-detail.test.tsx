import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { snapshotFixture, type HubSnapshot } from "@fhub/core";
import { MachinesView } from "../src/views/machines/MachinesView.tsx";
import { groupThreads } from "../src/views/machines/derive.ts";
import { formatBps, formatDuration, formatRelative, formatUsedOfGb } from "../src/lib/format.ts";
import { ago } from "../src/views/machines/derive.ts";
import { NOW_MS, renderAt } from "./helpers.tsx";

const open = (id: string, snap: HubSnapshot = snapshotFixture) => {
  renderAt(<MachinesView snapshot={snap} />);
  fireEvent.click(screen.getByRole("button", { name: `Ver detalle de ${snap.machines.find((m) => m.id === id)!.name}` }));
  return screen.getByTestId("machine-detail");
};
const group = (panel: HTMLElement, state: string) => panel.querySelector(`section[data-state="${state}"]`) as HTMLElement | null;

describe("machine detail panel", () => {
  it("starts empty and opens/closes on selection", () => {
    renderAt(<MachinesView snapshot={snapshotFixture} />);
    expect(screen.getByTestId("detail-empty")).toBeTruthy();
    expect(screen.queryByTestId("machine-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver detalle de bixku-vps" }));
    expect(screen.getByTestId("machine-detail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
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
    expect(within(panel).queryByText("API de trabajo: validaciones")).toBeNull();
    expect(within(panel).getByText("Hilos de T3 · 7")).toBeTruthy();
  });

  it("shows running-since, needs-you, project, provider/model, branch and updated time", () => {
    const panel = open("bixku-vps");
    const th01 = within(panel).getByTestId("thread-th_01");
    expect(within(th01).getAllByText("corriendo 14m").length).toBeGreaterThan(0);
    const th03 = within(panel).getByTestId("thread-th_03");
    expect(within(th03).getByText("te necesita")).toBeTruthy();
    expect(within(th03).getByText("dotfiles")).toBeTruthy();
    expect(within(th03).getByText("actualizado hace 42m")).toBeTruthy();
    const th06 = within(panel).getByTestId("thread-th_06");
    expect(within(th06).getByText("codex · gpt-5.5")).toBeTruthy();
    expect(within(th06).getByText("último run failed")).toBeTruthy();
    expect(within(th06).getByText("actualizado hace 2d 4h")).toBeTruthy();
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
    expect(within(child).getByText(/subagente de “fhub fase 1 \(coordinador\)”/)).toBeTruthy();
  });

  it("hides archived threads behind a toggle", () => {
    const panel = open("bixku-mbp");
    expect(within(panel).getByTestId("thread-th_13")).toBeTruthy();
    expect(within(panel).queryByTestId("thread-th_14")).toBeNull();
    const toggle = within(panel).getByRole("button", { name: "Mostrar archivados (1)" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(within(panel).getByTestId("thread-th_14")).toBeTruthy();
    expect(group(panel, "archived")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Ocultar archivados (1)" }));
    expect(within(panel).queryByTestId("thread-th_14")).toBeNull();
  });

  it("warns when the T3 source of the machine is unreachable", () => {
    const panel = open("bixku-mbp");
    const alert = within(panel).getByRole("alert");
    expect(alert.textContent).toMatch(/agent unreachable \(timeout 3s\)/);
    expect(alert.textContent).toMatch(/hace 1d 2h/);
    cleanupAndOpen();
    function cleanupAndOpen() {
      // healthy machine has no alert
      fireEvent.click(screen.getByRole("button", { name: "Ver detalle de bixku-vps" }));
      expect(within(screen.getByTestId("machine-detail")).queryByRole("alert")).toBeNull();
    }
  });

  it("renders CPU/RAM sparklines from history, or an explicit empty state", () => {
    const panel = open("pc-bixku");
    const cpu = within(panel).getByRole("img", { name: /^Historial de CPU, últimos 29 min/ });
    expect(cpu.querySelector("path.ui-spark__line")?.getAttribute("d")).toMatch(/^M[\d.]+ [\d.]+ L/);
    expect(within(panel).getByRole("img", { name: /^Historial de RAM/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ver detalle de MBP Omarchy" }));
    const mbp = screen.getByTestId("machine-detail");
    expect(within(mbp).queryByRole("img", { name: /Historial/ })).toBeNull();
    expect(within(mbp).getByText(/Sin historial de métricas \(máquina offline\)/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ver detalle de MBA" }));
    const mba = screen.getByTestId("history-empty");
    expect(mba.textContent).toContain("Sin historial de métricas: sin fuente de métricas");
    expect(mba.textContent).toContain("BESZEL_URL");
  });

  it("machine without a T3 source says T3 is not connected there, and how to connect it", () => {
    const panel = open("bixku-mba");
    const empty = within(panel).getByTestId("threads-empty");
    expect(empty.getAttribute("data-source-state")).toBe("missing");
    expect(empty.textContent).toContain("T3 no está conectado en esta máquina.");
    expect(empty.textContent).toContain("agentUrl");
  });

  it("machine with a working T3 source and no threads says there are none", () => {
    const snap: HubSnapshot = { ...snapshotFixture, threads: snapshotFixture.threads.filter((t) => t.machineId !== "bixku-focaltec") };
    const panel = open("bixku-focaltec", snap);
    const empty = within(panel).getByTestId("threads-empty");
    expect(empty.getAttribute("data-source-state")).toBe("ok");
    expect(empty.textContent).toBe("Sin hilos de T3 en esta máquina.");
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

  it("formats durations, rates, sizes and relative time via the shared formatters", () => {
    const now = NOW_MS;
    expect(formatDuration(1_904_400)).toBe("22d 1h");
    expect(formatDuration(51_000)).toBe("14h 10m");
    expect(formatDuration(null)).toBe("—");
    expect(formatBps(182_000)).toBe("178 KB/s"); // bytes/s, base 1024 (shared convention)
    expect(formatBps(null)).toBe("—");
    expect(formatUsedOfGb(5.3, 7.5)).toBe("5.3 / 7.5 GB");
    expect(formatUsedOfGb(1846, 2000)).toBe("1.8 / 2.0 TB");
    expect(formatRelative(new Date(now - 3_000).toISOString(), now)).toBe("just now");
    expect(formatRelative(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3h ago");
    expect(formatRelative(new Date(now + 5 * 60_000).toISOString(), now)).toBe("in 5m");
    expect(ago(null, now)).toBe("nunca");
    expect(ago(new Date(now - 5 * 60_000).toISOString(), now)).toBe("hace 5m");
  });
});
