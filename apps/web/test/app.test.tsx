import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../src/shell/App.tsx";
import { getDataMode } from "../src/data/useSnapshot.ts";
import { routes } from "../src/routes.tsx";
import { snapshotFixture, workFixture } from "@fhub/core";

describe("data mode", () => {
  it("is live by default; fixture only when asked by URL or VITE_DATA_MODE", () => {
    expect(getDataMode("", undefined)).toBe("live");
    expect(getDataMode("", "")).toBe("live");
    expect(getDataMode("?data=fixture", undefined)).toBe("fixture");
    expect(getDataMode("", "fixture")).toBe("fixture");
    expect(getDataMode("?data=live", "fixture")).toBe("live"); // the URL wins over the build variable
    expect(getDataMode("?data=bogus", undefined)).toBe("live");
  });
});

describe("app skeleton", () => {
  it("renders the default view from fixtures", () => {
    render(<App mode="fixture" />);
    expect(screen.getByTestId("view-work")).toBeTruthy();
  });
  it("every route renders with the fixture snapshot", () => {
    for (const r of routes) {
      const V = r.component;
      const { unmount } = render(<V snapshot={snapshotFixture} work={{ data: workFixture, error: null, mode: "fixture" }} />);
      expect(screen.getByTestId(`view-${r.id}`)).toBeTruthy();
      unmount();
    }
  });
});
