import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { deriveWork, snapshotFixture, workFixture, type WorkItem, type WorkSnapshot } from "@b-net/core";
import type { WorkState } from "../src/data/useSnapshot.ts";
import { App } from "../src/shell/App.tsx";
import { WorkView } from "../src/views/work/WorkView.tsx";
import { NOW_MS, renderAt } from "./helpers.tsx";

const state = (data: WorkSnapshot | null, error: string | null = null): WorkState => ({ data, error, mode: "fixture" });
const view = (data: WorkSnapshot | null, error: string | null = null) => renderAt(<WorkView snapshot={snapshotFixture} work={state(data, error)} />);
const derived = (over: Partial<Parameters<typeof deriveWork>[0]> = {}) =>
  deriveWork({ now: NOW_MS, threads: snapshotFixture.threads, sources: snapshotFixture.sources, catalog: [], ...over });

afterEach(() => history.replaceState(null, "", "/"));

describe("work view: Te espera", () => {
  it("lists what needs Facundo first, most urgent first, with kind word, glyph shape and a T3 link", () => {
    view(workFixture);
    const sections = screen.getAllByTestId(/^section-/).map((s) => s.getAttribute("data-testid"));
    expect(sections).toEqual(["section-waiting", "section-running", "section-done"]);

    const waiting = within(screen.getByTestId("section-waiting"));
    const cards = waiting.getAllByRole("article");
    expect(cards[0]!.textContent).toContain("Revisar PR de dotfiles");
    expect(cards[0]!.textContent).toContain("Espera tu respuesta");
    expect(cards[0]!.textContent).toContain("hace 42m");
    expect(cards[0]!.querySelector(".ui-dot")?.getAttribute("data-shape")).toBe("triangle");
    const link = within(cards[0]!).getByRole("link", { name: "Abrir en T3: Revisar PR de dotfiles" });
    expect(link.getAttribute("href")).toBe("t3-thread://th_03?machine=bixku-vps");
    expect(link.getAttribute("target")).toBeNull();
    // The failed run comes after the waiting thread, as a square (danger) with its own word.
    const failed = cards.find((c) => c.textContent!.includes("Bot de Telegram: comandos"))!;
    expect(failed.textContent).toContain("Falló o se interrumpió");
    expect(failed.querySelector(".ui-dot")?.getAttribute("data-shape")).toBe("square");
    expect(cards.indexOf(failed)).toBeGreaterThan(0);
  });

  it("says plainly when nothing waits, and that PR reviews need GitHub", () => {
    const calm = { ...workFixture, waiting: [] };
    view(calm);
    expect(screen.getByTestId("waiting-empty").textContent).toContain("Nada te espera.");
    expect(screen.getByTestId("gap-waiting-prs").textContent).toContain("GitHub sin conectar");
  });

  it("explains what to connect when T3 is missing instead of showing an empty list", () => {
    view(derived({ sources: [], threads: [], catalog: null }));
    const gap = screen.getByTestId("gap-waiting-threads");
    expect(gap.getAttribute("data-source-state")).toBe("missing");
    expect(gap.textContent).toContain("T3_EXPORTERS");
    expect(screen.getByTestId("gap-running-threads")).toBeTruthy();
    expect(screen.queryByTestId("waiting-empty")).toBeNull();
    expect(screen.getByTestId("gap-done-projects").textContent).toContain("HUB_DATA_DIR");
  });

  it("marks a failing T3 source differently from a missing one", () => {
    view(derived({ sources: [{ source: "t3", machineId: null, ok: false, lastSuccessAt: null, error: "timeout" }], threads: [] }));
    const gap = screen.getByTestId("gap-waiting-threads");
    expect(gap.getAttribute("data-source-state")).toBe("failing");
    expect(gap.textContent).toContain("T3 no responde");
  });
});

describe("work view: En curso and Listo", () => {
  it("groups running threads by project with run time and machine", () => {
    view(workFixture);
    const running = screen.getByTestId("section-running");
    const groups = within(running).getAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["En curso en b-net", "En curso en work-api"]);
    const coord = within(running).getByTestId("run-running:bixku-vps:th_01");
    expect(coord.textContent).toContain("14m");
    expect(coord.textContent).toContain("bixku-vps");
    expect(within(running).getByTestId("run-running:bixku-focaltec:th_08").textContent).toContain("Mac mini Focaltec");
  });

  it("shows finished threads, new deliverables and linked PRs, newest first, each with its link", () => {
    view(workFixture);
    const done = screen.getByTestId("section-done");
    const rows = within(done).getAllByRole("listitem");
    expect(rows[0]!.textContent).toContain("Resumen: pase de UI con fstack");
    const deliv = within(done).getByRole("link", { name: "Ver entregable: Resumen: pase de UI con fstack" });
    expect(deliv.getAttribute("href")).toBe("#/projects/b-net/d/0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1");
    const pr = within(done).getByRole("link", { name: "Ver PR: Facundo-Barbera/b-net#1" });
    expect(pr.getAttribute("href")).toBe("https://github.com/Facundo-Barbera/b-net/pull/1");
    expect(pr.getAttribute("target")).toBe("_blank");
    expect(pr.getAttribute("rel")).toContain("noopener");
    const times = rows.map((r) => r.querySelector("time")!.getAttribute("dateTime")!);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("handles many items and long titles", () => {
    const long = "x".repeat(280);
    const item = (i: number): WorkItem => ({ ...workFixture.waiting[0]!, id: `needs_input:m:${i}`, title: `${long} ${i}` });
    view({ ...workFixture, waiting: Array.from({ length: 40 }, (_, i) => item(i)) });
    expect(within(screen.getByTestId("section-waiting")).getAllByRole("article")).toHaveLength(40);
    expect(screen.getByRole("heading", { level: 1, name: "Trabajo" })).toBeTruthy();
  });
});

describe("work view: states and fleet strip", () => {
  it("loading and error", () => {
    const { unmount } = view(null);
    expect(screen.getByTestId("work-loading").getAttribute("role")).toBe("status");
    unmount();
    view(null, "HTTP 404");
    expect(screen.getByTestId("work-error").textContent).toContain("/api/v1/work: HTTP 404");
  });

  it("keeps the last data and warns when a refresh fails", () => {
    view(workFixture, "HTTP 502");
    expect(screen.getByRole("alert").textContent).toContain("HTTP 502");
    expect(screen.getByTestId("section-waiting")).toBeTruthy();
  });

  it("fleet strip: every machine with glyph, status word and CPU when known, linking to Máquinas", () => {
    view(workFixture);
    const strip = screen.getByTestId("fleet-strip");
    expect(within(strip).getByRole("link").getAttribute("href")).toBe("#/machines");
    expect(strip.textContent).toContain("5/6");
    const mbp = screen.getByTestId("fleet-bixku-mbp");
    expect(mbp.textContent).toContain("Offline");
    expect(mbp.querySelector(".ui-dot")?.getAttribute("data-shape")).toBe("square");
    expect(screen.getByTestId("fleet-bixku-vps").textContent).toContain("CPU 62%");
    expect(screen.getByTestId("fleet-bixku-mba").textContent).not.toContain("CPU");
  });
});

describe("keyboard shortcuts", () => {
  it("g w / g p / g m navigate; other keys, text fields and modifiers do not", async () => {
    render(<App mode="fixture" />);
    const press = (key: string, target: Window | Element = window) => fireEvent.keyDown(target, { key });

    press("g");
    press("p");
    expect(location.hash).toBe("#/projects");
    expect(await screen.findByTestId("view-projects")).toBeTruthy();
    press("g");
    press("m");
    expect(location.hash).toBe("#/machines");
    press("g");
    press("w");
    expect(location.hash).toBe("#/work");

    press("p"); // no "g" first
    expect(location.hash).toBe("#/work");
    press("g");
    press("x"); // unknown second key disarms
    press("p");
    expect(location.hash).toBe("#/work");

    const input = document.createElement("input");
    document.body.appendChild(input);
    press("g", input);
    press("p", input);
    expect(location.hash).toBe("#/work");
    input.remove();

    fireEvent.keyDown(window, { key: "g", ctrlKey: true });
    press("p");
    expect(location.hash).toBe("#/work");
  });
});
