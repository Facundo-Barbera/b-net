import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  Badge,
  Card,
  EmptyState,
  Meter,
  NowProvider,
  Panel,
  RelativeTime,
  Sparkline,
  Stat,
  StatusDot,
  buildSparkline,
  meterTone,
  toneForMachineStatus,
  toneForPoolState,
  toneForSecretStatus,
} from "../src/components/index.ts";

const NOW = Date.parse("2026-11-15T20:30:00.000Z");

describe("Card / Panel", () => {
  it("renders a titled region with actions and body", () => {
    render(
      <Card title="CPU" subtitle="6" actions={<button>act</button>}>
        <p>body</p>
      </Card>,
    );
    const region = screen.getByRole("region", { name: /CPU/ });
    expect(within(region).getByRole("heading", { level: 2 }).textContent).toContain("CPU");
    expect(within(region).getByText("body")).toBeTruthy();
    expect(within(region).getByRole("button", { name: "act" })).toBeTruthy();
  });

  it("supports heading level, flush body and the Panel alias", () => {
    expect(Panel).toBe(Card);
    const { container } = render(<Card title="x" headingLevel={3} flush>y</Card>);
    expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
    expect(container.querySelector(".ui-card__body--flush")).toBeTruthy();
  });

  it("renders no header without title/actions", () => {
    const { container } = render(<Card>only body</Card>);
    expect(container.querySelector("header")).toBeNull();
  });
});

describe("StatusDot", () => {
  it("is decorative without a label and an image with one", () => {
    const { container, rerender } = render(<StatusDot tone="warn" />);
    const dot = container.querySelector(".ui-dot")!;
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    expect(dot.className).toContain("tone-warn");
    rerender(<StatusDot tone="ok" label="online" pulse />);
    expect(screen.getByRole("img", { name: "online" }).className).toContain("ui-dot--pulse");
  });
});

describe("Badge", () => {
  it("applies tone and variant classes", () => {
    render(<Badge tone="danger" variant="outline" data-testid="b">down</Badge>);
    const b = screen.getByTestId("b");
    expect(b.className).toContain("tone-danger");
    expect(b.className).toContain("ui-badge--outline");
    expect(b.textContent).toBe("down");
  });
});

describe("Meter", () => {
  const tone = (el: HTMLElement) => el.closest(".ui-meter")!.getAttribute("data-tone");

  it("uses warn/danger thresholds", () => {
    expect(meterTone(10)).toBe("ok");
    expect(meterTone(70)).toBe("warn");
    expect(meterTone(89.9)).toBe("warn");
    expect(meterTone(90)).toBe("danger");
    expect(meterTone(50, 40, 60)).toBe("warn");

    const { rerender } = render(<Meter value={95} label="CPU" />);
    expect(tone(screen.getByRole("meter"))).toBe("danger");
    rerender(<Meter value={75} label="CPU" />);
    expect(tone(screen.getByRole("meter"))).toBe("warn");
    rerender(<Meter value={10} label="CPU" />);
    expect(tone(screen.getByRole("meter"))).toBe("ok");
  });

  it("exposes value semantics and clamps", () => {
    render(<Meter value={150} label="Disk" />);
    const m = screen.getByRole("meter", { name: "Disk" });
    expect(m.getAttribute("aria-valuenow")).toBe("100");
    expect(m.getAttribute("aria-valuetext")).toBe("100%");
    expect((m.firstElementChild as HTMLElement).style.width).toBe("100%");
  });

  it("handles missing values, custom text and a fixed tone", () => {
    const { rerender } = render(<Meter value={null} label="RAM" />);
    const m = screen.getByRole("meter");
    expect(m.getAttribute("aria-valuenow")).toBeNull();
    expect(m.getAttribute("aria-valuetext")).toBe("—");
    rerender(<Meter value={95} label="RAM" valueText="12.9 / 23.9 GB" tone="info" />);
    expect(screen.getByText("12.9 / 23.9 GB")).toBeTruthy();
    expect(tone(screen.getByRole("meter"))).toBe("info");
  });
});

describe("Sparkline", () => {
  it("computes geometry inside the fixed domain", () => {
    const s = buildSparkline([0, 50, 100], 100, 20, { min: 0, max: 100, pad: 0 });
    expect(s.line).toBe("M0 20 L50 10 L100 0");
    expect(s.last).toEqual({ x: 100, y: 0 });
    expect(s.area.endsWith("Z")).toBe(true);
  });

  it("needs two finite points and skips NaN", () => {
    expect(buildSparkline([1], 50, 10).line).toBe("");
    expect(buildSparkline([1, Number.NaN], 50, 10).line).toBe("");
    expect(buildSparkline([3, 3, 3], 50, 10).line).toContain("M");
  });

  it("renders a path, or a dashed baseline when empty; label makes it an image", () => {
    const { container, rerender } = render(<Sparkline values={[1, 3, 2, 5]} />);
    expect(container.querySelector(".ui-spark__line")).toBeTruthy();
    expect(container.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    rerender(<Sparkline values={[]} label="CPU trend" />);
    expect(container.querySelector(".ui-spark__empty")).toBeTruthy();
    expect(screen.getByRole("img", { name: "CPU trend" })).toBeTruthy();
  });
});

describe("Stat", () => {
  it("renders label, mono value, unit and hint", () => {
    const { container } = render(<Stat label="Memory" value="12.9" unit="GB" hint="of 23.9" tone="warn" />);
    expect(screen.getByText("Memory")).toBeTruthy();
    const value = container.querySelector(".ui-stat__value")!;
    expect(value.className).toContain("num");
    expect(value.textContent).toBe("12.9GB");
    expect(screen.getByText("of 23.9")).toBeTruthy();
    expect(container.firstElementChild!.className).toContain("tone-warn");
  });
});

describe("RelativeTime", () => {
  it("formats against an explicit now and exposes the absolute time", () => {
    render(<RelativeTime value="2026-11-15T20:25:00.000Z" now={NOW} />);
    const t = screen.getByText("5m ago");
    expect(t.tagName).toBe("TIME");
    expect(t.getAttribute("dateTime")).toBe("2026-11-15T20:25:00.000Z");
    expect(t.getAttribute("title")).toBe("2026-11-15 20:25 UTC");
  });

  it("reads now from NowProvider and prefers the prop", () => {
    const { rerender } = render(
      <NowProvider value={NOW}>
        <RelativeTime value="2026-11-15T20:29:00.000Z" />
      </NowProvider>,
    );
    expect(screen.getByText("1m ago")).toBeTruthy();
    rerender(
      <NowProvider value={NOW}>
        <RelativeTime value="2026-11-15T20:29:00.000Z" now={NOW + 3600_000} />
      </NowProvider>,
    );
    expect(screen.getByText("1h ago")).toBeTruthy();
  });

  it("renders the fallback for null", () => {
    const { rerender } = render(<RelativeTime value={null} />);
    expect(screen.getByText("—")).toBeTruthy();
    rerender(<RelativeTime value={undefined} fallback="never" />);
    expect(screen.getByText("never")).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("renders title, description, action and role", () => {
    render(<EmptyState role="alert" title="Nothing here" description="Try later" action={<button>retry</button>} />);
    const el = screen.getByRole("alert");
    expect(el.textContent).toContain("Nothing here");
    expect(el.textContent).toContain("Try later");
    expect(within(el).getByRole("button", { name: "retry" })).toBeTruthy();
  });
});

describe("tone mappers", () => {
  it("map contract enums to tones", () => {
    expect(toneForMachineStatus("online")).toBe("ok");
    expect(toneForMachineStatus("degraded")).toBe("warn");
    expect(toneForMachineStatus("offline")).toBe("danger");
    expect(toneForMachineStatus("paused")).toBe("idle");
    expect(toneForMachineStatus("unknown")).toBe("dormant");
    expect(toneForPoolState("active")).toBe("ok");
    expect(toneForPoolState("cooldown")).toBe("warn");
    expect(toneForPoolState("error")).toBe("danger");
    expect(toneForPoolState("standby")).toBe("idle");
    expect(toneForPoolState("disabled")).toBe("dormant");
    expect(toneForSecretStatus("ok")).toBe("ok");
    expect(toneForSecretStatus("expiring")).toBe("warn");
    expect(toneForSecretStatus("expired")).toBe("danger");
    expect(toneForSecretStatus("unknown")).toBe("dormant");
  });
});
