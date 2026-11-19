import { afterEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { boardFixture, snapshotFixture, workFixture } from "@b-net/core";
import type { BoardState } from "../src/data/useSnapshot.ts";
import { ProjectsView } from "../src/views/projects/ProjectsView.tsx";
import { WorkView } from "../src/views/work/WorkView.tsx";
import { renderAt } from "./helpers.tsx";

const ok: BoardState = { data: boardFixture, error: null, missing: false };
const missing: BoardState = { data: null, error: "HTTP 503", missing: true };
const work = { data: workFixture, error: null, mode: "fixture" as const };

afterEach(() => history.replaceState(null, "", "/"));

describe("work view: board", () => {
  it("lists open tasks across projects, blocked first, each with a state word and glyph", () => {
    renderAt(<WorkView snapshot={snapshotFixture} work={work} board={ok} />);
    const section = screen.getByTestId("board-tasks");
    const rows = within(section).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("data-state"))).toEqual(["bloqueado", "bloqueado", "en_curso", "en_espera"]);
    expect(rows[0]!.textContent).toContain("Bloqueada");
    expect(rows[0]!.querySelector(".ui-dot")?.getAttribute("data-shape")).toBe("triangle");
    const running = within(section).getByTestId("board-task-37");
    expect(running.textContent).toContain("En curso");
    expect(running.textContent).toContain("orquestador");
    expect(within(running).getByRole("link", { name: "Facundo-Barbera/b-net#5" }).getAttribute("href")).toBe("https://github.com/Facundo-Barbera/b-net/pull/5");
    // Finished tasks stay in the project, not on the home.
    expect(section.textContent).not.toContain("Métricas propias");
  });

  it("shows bot notices with kind word, bot and link", () => {
    renderAt(<WorkView snapshot={snapshotFixture} work={work} board={ok} />);
    const events = screen.getByTestId("board-events");
    expect(events.textContent).toContain("Pregunta");
    expect(events.textContent).toContain("para fstack-vps");
    expect(events.textContent).toContain("Bloqueo");
    const items = within(events).getAllByRole("listitem");
    expect(items[0]!.getAttribute("data-kind")).toBe("question");
    expect(items.map((i) => i.querySelector(".ui-dot")?.getAttribute("data-shape"))).toContain("square");
  });

  it("says what to connect when the hub runs no board, and stays out when no board prop is given", () => {
    const { unmount } = renderAt(<WorkView snapshot={snapshotFixture} work={work} board={missing} />);
    const gap = screen.getByTestId("board-gap");
    expect(gap.getAttribute("data-source-state")).toBe("missing");
    expect(gap.textContent).toContain("HUB_BOARD_URL");
    expect(screen.queryByTestId("board-events")).toBeNull();
    unmount();
    renderAt(<WorkView snapshot={snapshotFixture} work={work} />);
    expect(screen.queryByTestId("board-tasks")).toBeNull();
  });
});

describe("project detail: board", () => {
  it("shows the project's tasks, updates with summaries, notices and board PRs", () => {
    history.replaceState(null, "", "/#/projects/b-net");
    renderAt(<ProjectsView snapshot={snapshotFixture} work={work} board={ok} />);
    const tasks = within(screen.getByTestId("project-board-tasks")).getAllByRole("listitem");
    expect(tasks.map((t) => t.getAttribute("data-state"))).toEqual(["bloqueado", "en_curso", "en_espera", "listo"]);
    expect(tasks[3]!.textContent).toContain("Lista");

    const updates = screen.getByTestId("project-board-updates");
    expect(updates.textContent).toContain("Tests del hub en verde");
    expect(within(updates).getByRole("link", { name: "Resumen: pase de UI con fstack" }).getAttribute("href")).toBe("#/projects/b-net/d/0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1");

    expect(screen.getByTestId("project-board-events").textContent).toContain("Hilo terminado");

    const prs = screen.getByTestId("project-board-prs");
    expect(prs.textContent).toContain("Fusionado");
    expect(prs.textContent).toContain("Abierto");
    expect(within(prs).getByRole("link", { name: /Ver PR Facundo-Barbera\/b-net#4/ }).getAttribute("href")).toBe("https://github.com/Facundo-Barbera/b-net/pull/4");
    // The old "Tareas sin conectar" gap gives way to the board's tasks.
    expect(screen.queryByTestId("gap-project-tasks")).toBeNull();
  });

  it("explains the missing board in the tasks card", () => {
    history.replaceState(null, "", "/#/projects/b-net");
    renderAt(<ProjectsView snapshot={snapshotFixture} work={work} board={missing} />);
    expect(within(screen.getByTestId("project-tasks")).getByTestId("board-gap").textContent).toContain("Tablero sin conectar");
  });
});
