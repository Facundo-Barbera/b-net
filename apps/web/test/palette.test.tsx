import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { workFixture } from "@fhub/core";
import { routes } from "../src/routes.tsx";
import { App } from "../src/shell/App.tsx";
import { buildPaletteEntries, filterPalette } from "../src/shell/palette.ts";
import { fold } from "../src/lib/text.ts";

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe("palette entries", () => {
  it("lists views first, then waiting, running and projects; works without work data", () => {
    const all = buildPaletteEntries(routes, workFixture);
    expect(all.slice(0, routes.length).map((e) => e.href)).toEqual(routes.map((r) => r.path));
    expect(all.filter((e) => e.group === "Te espera")).toHaveLength(workFixture.waiting.length);
    expect(all.filter((e) => e.group === "En curso")).toHaveLength(workFixture.running.length);
    expect(all.filter((e) => e.group === "Proyectos")).toHaveLength(workFixture.projects.length);
    // Waiting items carry their kind in words and a tone (glyph), not colour alone.
    expect(all.find((e) => e.group === "Te espera")!.hint).toContain("Espera tu respuesta");
    expect(buildPaletteEntries(routes, null)).toHaveLength(routes.length);
  });

  it("filters by every word, ignoring case and accents", () => {
    const all = buildPaletteEntries(routes, workFixture);
    expect(filterPalette(all, "maquinas").map((e) => e.label)).toEqual(["Máquinas"]);
    expect(filterPalette(all, "")).toHaveLength(all.length);
    expect(filterPalette(all, "zzz-nada")).toEqual([]);
    expect(fold("Máquinas ÑU")).toBe("maquinas nu");
  });
});

describe("command palette", () => {
  const openWithKeys = () => fireEvent.keyDown(window, { key: "k", ctrlKey: true });

  it("opens with Ctrl K or the top bar button, focuses the search and closes with Escape", () => {
    render(<App mode="fixture" />);
    expect(screen.queryByTestId("command-palette")).toBeNull();

    openWithKeys();
    const dialog = screen.getByRole("dialog", { name: "Buscar o ir a" });
    const input = within(dialog).getByRole("combobox");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByTestId("command-palette")).toBeNull();

    fireEvent.click(screen.getByTestId("palette-trigger"));
    expect(screen.getByRole("dialog", { name: "Buscar o ir a" })).toBeTruthy();
    openWithKeys(); // the shortcut toggles
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("filters as you type and opens the highlighted entry with Enter", () => {
    render(<App mode="fixture" />);
    openWithKeys();
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "secre" } });
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(location.hash).toBe("#/secrets");
    expect(screen.queryByTestId("command-palette")).toBeNull();
  });

  it("moves with the arrows (wrapping) and says when nothing matches", () => {
    render(<App mode="fixture" />);
    openWithKeys();
    const input = screen.getByRole("combobox");
    const selected = () => screen.getAllByRole("option").findIndex((o) => o.getAttribute("aria-selected") === "true");
    expect(selected()).toBe(0);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe(1);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(selected()).toBe(screen.getAllByRole("option").length - 1);

    fireEvent.change(input, { target: { value: "zzz-nada" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toContain("zzz-nada");
  });
});
