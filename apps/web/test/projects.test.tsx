import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { deriveWork, projectsFixture, snapshotFixture, workFixture, type WorkSnapshot } from "@fhub/core";
import type { DataMode } from "../src/data/useSnapshot.ts";
import { ProjectsView } from "../src/views/projects/ProjectsView.tsx";
import { NOW_MS, renderAt } from "./helpers.tsx";

const view = (data: WorkSnapshot | null = workFixture, mode: DataMode = "fixture") =>
  renderAt(<ProjectsView snapshot={snapshotFixture} work={{ data, error: null, mode }} />);
const at = (hash: string) => history.replaceState(null, "", `/${hash}`);

afterEach(() => {
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("projects list", () => {
  it("registered projects first with counters in words, then T3 titles nobody claims, then threads without project", () => {
    view();
    const registered = within(screen.getByTestId("projects-registered")).getAllByRole("link");
    expect(registered.map((l) => l.getAttribute("href"))).toEqual(["#/projects/fhub", "#/projects/homelab-ops", "#/projects/bixku-bot"]);
    const bnet = screen.getByTestId("project-fhub");
    expect(bnet.textContent).toContain("2 en curso");
    expect(bnet.textContent).toContain("2 PRs");
    expect(bnet.textContent).toContain("2 entregables");
    // Glyph next to a non-zero status counter, none at zero (board counters have their own row, see board.test).
    expect(bnet.querySelector(".pj-counters:not(.pj-board-counts)")!.querySelectorAll(".ui-dot")).toHaveLength(1);
    expect(screen.getByTestId("project-bixku-bot").textContent).toContain("1 en espera");

    const inferred = within(screen.getByTestId("projects-inferred")).getAllByRole("link").map((l) => l.textContent);
    expect(inferred.some((t) => t!.startsWith("dotfiles"))).toBe(true);
    expect(screen.getByTestId("project-t3:dotfiles").getAttribute("href")).toBe("#/projects/t3%3Adotfiles");
  });

  it("says what to connect when the hub has no projects storage", () => {
    view(deriveWork({ now: NOW_MS, threads: snapshotFixture.threads, sources: snapshotFixture.sources, catalog: null }));
    const gap = within(screen.getByTestId("projects-registered")).getByTestId("gap-projects");
    expect(gap.textContent).toContain("HUB_DATA_DIR");
  });
});

describe("projects filters", () => {
  const hrefs = (testId: string) => within(screen.getByTestId(testId)).queryAllByRole("link").map((l) => l.getAttribute("href"));

  it("search narrows by name or description, accent-insensitive, and says when nothing matches", () => {
    view();
    const search = screen.getByRole("searchbox", { name: "Buscar proyectos" });
    fireEvent.change(search, { target: { value: "MAQUINAS" } });
    expect(hrefs("projects-registered")).toEqual(["#/projects/fhub"]);
    fireEvent.change(search, { target: { value: "zzz-nada" } });
    expect(hrefs("projects-registered")).toEqual([]);
    expect(screen.getByTestId("projects-registered").textContent).toContain("Ningún proyecto coincide");
  });

  it("'Con actividad' keeps projects with something waiting or running, and marks them with words, not only an edge", () => {
    view();
    const group = screen.getByRole("group", { name: "Filtrar proyectos" });
    fireEvent.click(within(group).getByRole("button", { name: /Con actividad/ }));
    expect(within(group).getByRole("button", { name: /Con actividad/ }).getAttribute("aria-pressed")).toBe("true");
    const kept = hrefs("projects-registered");
    expect(kept).toContain("#/projects/fhub");
    expect(kept).toContain("#/projects/bixku-bot");
    expect(kept).not.toContain("#/projects/homelab-ops");
    const bot = screen.getByTestId("project-bixku-bot");
    expect(bot.getAttribute("data-attention")).toBe("waiting");
    expect(bot.textContent).toContain("1 en espera");
  });
});

describe("project detail", () => {
  it("shows now, threads, PRs and git branches with honest gaps (fixture: no preview)", () => {
    at("#/projects/fhub");
    view();
    expect(screen.getByRole("heading", { level: 1, name: "fhub" })).toBeTruthy();
    expect(screen.getByText("registrado")).toBeTruthy();
    expect(within(screen.getByTestId("project-now")).getAllByRole("listitem")).toHaveLength(2);

    const threads = within(screen.getByTestId("project-threads"));
    expect(threads.getByRole("link", { name: "Abrir en T3: fhub fase 1 (coordinador)" }).getAttribute("href")).toBe("t3-thread://th_01?machine=bixku-vps");
    expect(threads.getAllByText("corriendo").length).toBeGreaterThan(0);

    const prs = screen.getByTestId("project-prs");
    expect(prs.textContent).toContain("Facundo-Barbera/fhub#1");
    expect(within(prs).getByTestId("gap-project-prs").textContent).toContain("GitHub");
    expect(screen.getByTestId("project-git").textContent).toContain("feat/proxy");
    expect(screen.getByTestId("gap-project-git").getAttribute("data-source-state")).toBe("missing");

    // Fixture deliverables are listed; the preview says it needs the hub instead of a broken frame.
    expect(screen.getByTestId("deliverable-0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1").getAttribute("aria-current")).toBe("true");
    expect(screen.getByTestId("viewer-fixture")).toBeTruthy();
    expect(screen.queryByTestId("viewer-frame")).toBeNull();
  });

  it("live: fetches the deliverables and embeds the selected one in a script-less sandboxed iframe", async () => {
    const list = projectsFixture[0]!.deliverables;
    const fetchMock = vi.fn((_url: string) => Promise.resolve(new Response(JSON.stringify({ deliverables: list }), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    at(`#/projects/fhub/d/${list[1]!.id}`);
    view(workFixture, "live");
    const frame = await screen.findByTestId("viewer-frame");
    // The board is fetched too (board.test covers it), so look for the call instead of assuming it is first.
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain("/api/v1/projects/fhub/deliverables");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("src")).toBe(`/api/v1/projects/fhub/deliverables/${list[1]!.id}/content`);
    expect(frame.getAttribute("title")).toBe(`Entregable: ${list[1]!.title}`);
    const viewer = screen.getByTestId("viewer");
    expect(within(viewer).getByRole("link", { name: /Descargar/ }).getAttribute("href")).toContain("?download=1");

    // Selecting another deliverable is a plain link (hash route), so it is bookmarkable.
    act(() => {
      location.hash = `#/projects/fhub/d/${list[0]!.id}`;
    });
    expect((await screen.findByTitle(`Entregable: ${list[0]!.title}`)).getAttribute("src")).toContain(list[0]!.id);
  });

  it("live: a PDF is framed without sandbox (browsers refuse sandboxed PDF) and errors are shown", async () => {
    const pdf = projectsFixture[2]!.deliverables;
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ deliverables: pdf }), { status: 200 }))));
    at("#/projects/bixku-bot");
    const { unmount } = view(workFixture, "live");
    const frame = await screen.findByTestId("viewer-frame");
    expect(frame.hasAttribute("sandbox")).toBe(false);
    unmount();

    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("{}", { status: 503 }))));
    view(workFixture, "live");
    expect((await screen.findByRole("alert")).textContent).toContain("HTTP 503");
  });

  it("an unregistered T3 project explains how to receive deliverables; an unknown key says so", () => {
    at("#/projects/t3%3Adotfiles");
    const { unmount } = view();
    expect(screen.getByRole("heading", { level: 1, name: "dotfiles" })).toBeTruthy();
    expect(screen.getByText("desde T3")).toBeTruthy();
    expect(screen.getByTestId("deliverables").textContent).toContain("no está registrado");
    unmount();

    at("#/projects/no-existe");
    view();
    expect(screen.getByTestId("project-missing").textContent).toContain("no-existe");
  });
});
