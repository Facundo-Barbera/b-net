import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/shell/App.tsx";
import { routes } from "../src/routes.tsx";
import { snapshotFixture } from "@b-net/core";

describe("app skeleton", () => {
  it("renders the default view from fixtures", () => {
    render(<App />);
    expect(screen.getByTestId("view-machines")).toBeTruthy();
  });
  it("every route renders with the fixture snapshot", () => {
    for (const r of routes) {
      const V = r.component;
      const { unmount } = render(<V snapshot={snapshotFixture} />);
      expect(screen.getByTestId(`view-${r.id}`)).toBeTruthy();
      unmount();
    }
  });
});
