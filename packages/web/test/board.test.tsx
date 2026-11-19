import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { boardProjectsFixture, snapshotFixture, workFixture, type BoardProjectsResponse } from "@b-net/core";
import { BOARD_PROJECTS_URL, parseBoardProjects, resolveBoardState } from "../src/data/useBoardProjects.ts";
import type { DataMode } from "../src/data/useSnapshot.ts";
import { countByState, leaseText, prRefUrl, safeHref } from "../src/views/projects/boardMeta.ts";
import { ProjectsView } from "../src/views/projects/ProjectsView.tsx";
import { spanEs } from "../src/lib/spanish.ts";
import { NOW_MS, renderAt } from "./helpers.tsx";

const view = (mode: DataMode = "fixture") => renderAt(<ProjectsView snapshot={snapshotFixture} work={{ data: workFixture, error: null, mode }} />);
const at = (hash: string) => history.replaceState(null, "", `/${hash}`);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const clone = (): BoardProjectsResponse => JSON.parse(JSON.stringify(boardProjectsFixture)) as BoardProjectsResponse;

/** Live fetch: the board answers `board`, deliverables answer an empty list (their own tests live in projects.test). */
function stubHub(board: () => Promise<Response>) {
  const fetchMock = vi.fn((url: string) => (url === BOARD_PROJECTS_URL ? board() : json({ deliverables: [] })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("board client", () => {
  it("accepts the contract's shape and rejects states the UI has no word for", () => {
    expect(parseBoardProjects(boardProjectsFixture)).toBe(boardProjectsFixture);

    const unknownState = clone();
    (unknownState.projects[0]!.tasks[0] as { state: string }).state = "pausada";
    expect(() => parseBoardProjects(unknownState)).toThrow("forma inesperada");

    const unknownKind = clone();
    (unknownKind.projects[0]!.events[0] as { kind: string }).kind = "ping";
    expect(() => parseBoardProjects(unknownKind)).toThrow();

    const noArrays = { generatedAt: "x", projects: [{ slug: "a", name: "A" }] };
    expect(() => parseBoardProjects(noArrays)).toThrow();
    expect(() => parseBoardProjects({ deliverables: [] })).toThrow();
  });

  it("falls back to the fixture only in dev; production says missing (404/503) or failing", () => {
    expect(resolveBoardState({ data: null, error: null }, "fixture", false)).toMatchObject({ origin: "fixture", data: boardProjectsFixture });

    const hub = clone();
    expect(resolveBoardState({ data: hub, error: "HTTP 500" }, "live", true)).toEqual({ data: hub, origin: "hub", error: "HTTP 500", missing: false });

    expect(resolveBoardState({ data: null, error: "HTTP 503" }, "live", true)).toEqual({ data: boardProjectsFixture, origin: "fixture", error: "HTTP 503", missing: false });

    expect(resolveBoardState({ data: null, error: "HTTP 503" }, "live", false)).toEqual({ data: null, origin: null, error: "HTTP 503", missing: true });
    expect(resolveBoardState({ data: null, error: "HTTP 404" }, "live", false).missing).toBe(true);
    expect(resolveBoardState({ data: null, error: "HTTP 500" }, "live", false)).toEqual({ data: null, origin: null, error: "HTTP 500", missing: false });
    expect(resolveBoardState({ data: null, error: null }, "live", false)).toEqual({ data: null, origin: null, error: null, missing: false });
  });
});

describe("board helpers", () => {
  it("only safe schemes become links", () => {
    expect(safeHref("https://github.com/x/y/pull/1")).toBe("https://github.com/x/y/pull/1");
    expect(safeHref("t3-thread://th_01?machine=m")).toBe("t3-thread://th_01?machine=m");
    expect(safeHref("#/projects/b-net")).toBe("#/projects/b-net");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });

  it("turns owner/repo#n into a GitHub URL and nothing else", () => {
    expect(prRefUrl("Facundo-Barbera/b-net#5")).toBe("https://github.com/Facundo-Barbera/b-net/pull/5");
    expect(prRefUrl("b-net#5")).toBeNull();
    expect(prRefUrl("a/b#0")).toBeNull();
  });

  it("counts tasks per state and words the lease", () => {
    expect(countByState(boardProjectsFixture.projects[0]!)).toEqual({ bloqueado: 1, en_curso: 1, en_espera: 2, listo: 1 });
    expect(countByState(boardProjectsFixture.projects[2]!)).toEqual({ bloqueado: 0, en_curso: 0, en_espera: 0, listo: 0 });
    expect(leaseText(new Date(NOW_MS + 9 * 60_000).toISOString(), NOW_MS, spanEs)).toBe("reserva vence en 9m");
    expect(leaseText(new Date(NOW_MS - 60_000).toISOString(), NOW_MS, spanEs)).toBe("reserva vencida");
  });
});

describe("projects list with the board", () => {
  it("each card counts board tasks with glyph and word; a blocked task marks the card in words too", () => {
    view();
    const bnet = screen.getByTestId("project-b-net");
    const counts = within(bnet).getByTestId("board-counts-b-net");
    expect(counts.textContent).toContain("Tareas");
    expect(counts.textContent).toContain("1 bloqueada");
    expect(counts.textContent).toContain("1 en curso");
    expect(counts.textContent).toContain("2 en espera");
    expect(counts.textContent).toContain("1 lista");
    // One glyph per non-zero state, and the blocked one is the square, not only a colour.
    expect(counts.querySelectorAll(".ui-dot")).toHaveLength(4);
    expect(counts.querySelector('[data-state="bloqueado"] .ui-dot')!.getAttribute("data-shape")).toBe("square");
    expect(bnet.getAttribute("data-attention")).toBe("blocked");

    // Waiting on Facundo (T3) still wins over a blocked task for the card edge.
    expect(screen.getByTestId("project-bixku-bot").getAttribute("data-attention")).toBe("waiting");
    // Empty board: no counters at all rather than a row of zeros.
    expect(within(screen.getByTestId("project-homelab-ops")).queryByTestId("board-counts-homelab-ops")).toBeNull();
    // Fixture mode is already labelled by the shell; no extra board notice.
    expect(screen.queryByTestId("board-fixture-notice")).toBeNull();
  });

  it("lists board projects the hub does not know, and opens them", async () => {
    const board = clone();
    board.projects.push({ slug: "notas", name: "Notas", bot: "notas-bot", tasks: [{ id: "1", title: "Ordenar", state: "bloqueado", updatedAt: board.generatedAt }], updates: [], prs: [], events: [], summaries: [] });
    stubHub(() => json(board));
    const { unmount } = view("live");
    const card = await screen.findByTestId("board-only-notas");
    expect(card.getAttribute("href")).toBe("#/projects/notas");
    expect(card.textContent).toContain("Solo en el tablero");
    expect(card.textContent).toContain("1 bloqueada");
    unmount();

    at("#/projects/notas");
    view("live");
    expect(await screen.findByRole("heading", { level: 1, name: "Notas" })).toBeTruthy();
    expect(screen.getByText("solo en el tablero")).toBeTruthy();
    expect(screen.getByTestId("lane-bloqueado").textContent).toContain("Ordenar");
  });
});

describe("project detail board", () => {
  it("with data: lanes by state, notices, updates, PRs and summaries that open the existing deliverable", () => {
    at("#/projects/b-net");
    view();
    const panel = screen.getByTestId("project-board");
    expect(within(panel).getByText("bot fstack-vps")).toBeTruthy();

    const blocked = screen.getByTestId("lane-bloqueado");
    expect(blocked.textContent).toContain("Bloqueadas");
    expect(blocked.querySelector(".ui-dot")!.getAttribute("data-shape")).toBe("square");
    expect(within(blocked).getByTestId("task-41").textContent).toContain("Facundo-Barbera/b-net#5");
    expect(within(blocked).getByRole("link", { name: "Facundo-Barbera/b-net#5" }).getAttribute("href")).toBe("https://github.com/Facundo-Barbera/b-net/pull/5");

    const running = within(screen.getByTestId("lane-en_curso")).getByTestId("task-37");
    expect(running.textContent).toContain("tomada por orquestador");
    expect(running.textContent).toContain("reserva vence en 9m");
    expect(within(screen.getByTestId("lane-en_espera")).getAllByRole("listitem")).toHaveLength(2);
    expect(within(screen.getByTestId("lane-listo")).getByTestId("task-29")).toBeTruthy();

    const events = screen.getByTestId("board-events");
    expect(within(events).getAllByRole("listitem").map((li) => li.getAttribute("data-kind"))).toEqual(["question", "thread_done"]);
    expect(within(events).getByTestId("event-question").textContent).toContain("Pregunta");
    expect(within(events).getByTestId("event-thread_done").textContent).toContain("Hilo terminado");

    const prs = screen.getByTestId("board-prs");
    expect(prs.textContent).toContain("Abierto");
    expect(prs.textContent).toContain("Fusionado");
    expect(prs.textContent).toContain("Cerrado");

    expect(screen.getByTestId("board-updates").textContent).toContain("faltan las capturas");

    const open = within(screen.getByTestId("board-summaries")).getByRole("link", { name: "Abrir resumen: Resumen: pase de UI con fstack" });
    expect(open.getAttribute("href")).toBe("#/projects/b-net/d/0b7c1d2e-3f40-4a51-9b62-7c83d94ea5f1");
    // The "tareas sin conectar" gap is gone: tasks come from the board now.
    expect(screen.queryByTestId("gap-project-tasks")).toBeNull();
  });

  it("blocked: the blocked lane and the blocked notice say so in words", () => {
    at("#/projects/bixku-bot");
    view();
    const lane = screen.getByTestId("lane-bloqueado");
    expect(lane.hasAttribute("data-filled")).toBe(true);
    expect(lane.textContent).toContain("Comandos nuevos del bot");
    expect(within(screen.getByTestId("board-events")).getByTestId("event-blocked").textContent).toContain("Bloqueo");
    expect(screen.getByTestId("lane-en_curso").textContent).toContain("Ninguna");
  });

  it("empty: names the channels bots publish to", () => {
    at("#/projects/homelab-ops");
    view();
    const empty = screen.getByTestId("board-empty");
    expect(empty.textContent).toContain("homelab-ops/tareas");
    expect(empty.textContent).toContain("homelab-ops/eventos");
    expect(screen.queryByTestId("board-tasks")).toBeNull();
  });

  it("live in dev without a board: example data with a notice that says why", async () => {
    vi.stubEnv("DEV", true);
    stubHub(() => json({}, 503));
    at("#/projects/b-net");
    view("live");
    expect((await screen.findByTestId("board-fixture-notice")).textContent).toContain("HTTP 503");
    expect(screen.getByTestId("lane-bloqueado")).toBeTruthy();
  });

  it("live in production without a board: says it is not connected, no example data", async () => {
    vi.stubEnv("DEV", false);
    stubHub(() => json({}, 503));
    at("#/projects/b-net");
    view("live");
    expect((await screen.findByTestId("board-missing")).textContent).toContain("Tablero sin conectar");
    expect(screen.queryByTestId("board-tasks")).toBeNull();
    expect(screen.queryByTestId("board-fixture-notice")).toBeNull();
  });

  it("live from the hub: renders its data and never links a bot's javascript: URL", async () => {
    const board = clone();
    board.projects[0]!.events[0]!.link = "javascript:alert(1)";
    board.projects[0]!.tasks[0]!.title = "Tarea del hub";
    const fetchMock = stubHub(() => json(board));
    at("#/projects/b-net");
    view("live");
    expect(await screen.findByText("Tarea del hub")).toBeTruthy();
    expect(fetchMock.mock.calls.map((c) => c[0])).toContain(BOARD_PROJECTS_URL);
    const question = within(screen.getByTestId("board-events")).getByTestId("event-question");
    expect(within(question).queryByRole("link")).toBeNull();
    expect(screen.queryByTestId("board-fixture-notice")).toBeNull();
  });
});
