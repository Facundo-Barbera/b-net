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
  StatStrip,
  StatusDot,
  Table,
  Tag,
  Callout,
  KV,
  KeyValue,
  PageHeader,
  buildSparkline,
  toneForServiceStatus,
  toneForThreadState,
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

describe("Badge dot / Tag", () => {
  it("prefixes a decorative dot only when asked", () => {
    const { container, rerender } = render(<Badge tone="ok">up</Badge>);
    expect(container.querySelector(".ui-badge__dot")).toBeNull();
    rerender(<Badge tone="ok" dot>up</Badge>);
    expect(container.querySelector(".ui-badge__dot")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("up");
  });

  it("Tag is a plain mono chip that forwards attributes", () => {
    render(<Tag title="hint" data-testid="t">v0.1.0</Tag>);
    expect(screen.getByTestId("t").className).toContain("ui-tag");
    expect(screen.getByTestId("t").getAttribute("title")).toBe("hint");
  });
});

describe("Card as article / bodyClassName", () => {
  it("renders an article and tags the body", () => {
    const { container } = render(<Card as="article" aria-label="m card" bodyClassName="x">y</Card>);
    expect(screen.getByRole("article", { name: "m card" })).toBeTruthy();
    expect(container.querySelector(".ui-card__body.x")).toBeTruthy();
  });
});

describe("Meter extensions", () => {
  it("rounds aria-valuenow, uses ariaLabel and shows detail", () => {
    render(<Meter value={91.5} ariaLabel="Uso 5 h" detail="5.3 / 7.5 GB" />);
    const m = screen.getByRole("meter", { name: "Uso 5 h" });
    expect(m.getAttribute("aria-valuenow")).toBe("92");
    expect(screen.getByText("5.3 / 7.5 GB")).toBeTruthy();
  });

  it("flags HIGH / CRIT only past the thresholds and only with `flag`", () => {
    const { rerender } = render(<Meter value={80} label="RAM" flag />);
    expect(screen.getByText("HIGH")).toBeTruthy();
    rerender(<Meter value={95} label="RAM" flag />);
    expect(screen.getByText("CRIT")).toBeTruthy();
    rerender(<Meter value={20} label="RAM" flag />);
    expect(screen.queryByText("HIGH")).toBeNull();
    expect(screen.queryByText("CRIT")).toBeNull();
    rerender(<Meter value={95} label="RAM" />);
    expect(screen.queryByText("CRIT")).toBeNull();
  });

  it("uses the shared thresholds by default (70 / 90)", () => {
    const tone = () => screen.getByRole("meter").closest(".ui-meter")!.getAttribute("data-tone");
    const { rerender } = render(<Meter value={69} label="x" />);
    expect(tone()).toBe("ok");
    rerender(<Meter value={70} label="x" />);
    expect(tone()).toBe("warn");
    rerender(<Meter value={90} label="x" />);
    expect(tone()).toBe("danger");
  });
});

describe("Sparkline extensions", () => {
  it("computes a reference line inside the domain only", () => {
    expect(buildSparkline([0, 100], 100, 20, { min: 0, max: 100, pad: 0, ref: 50 }).ref).toBe(10);
    expect(buildSparkline([0, 100], 100, 20, { min: 0, max: 100, pad: 0, ref: 150 }).ref).toBeNull();
    expect(buildSparkline([1], 100, 20, { ref: 1 }).ref).toBeNull();
  });

  it("stretches, takes a chart series and draws the reference line", () => {
    const { container } = render(<Sparkline values={[10, 60, 30]} min={0} max={100} series={2} stretch refLine={70} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("100%");
    expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg.getAttribute("class")).toContain("ui-spark--s2");
    expect(container.querySelector(".ui-spark__ref")).toBeTruthy();
  });
});

describe("RelativeTime format", () => {
  it("uses a custom formatter with the provider clock", () => {
    render(
      <NowProvider value={NOW}>
        <RelativeTime value="2026-11-15T20:25:00.000Z" format={(v, now) => `${now - Date.parse(String(v))} ms`} />
      </NowProvider>,
    );
    expect(screen.getByText("300000 ms").tagName).toBe("TIME");
  });
});

describe("EmptyState extensions", () => {
  it("forwards attributes, renders children and the compact variant", () => {
    const { container } = render(
      <EmptyState compact data-testid="e" title="Nada">
        <code>detail</code>
      </EmptyState>,
    );
    expect(screen.getByTestId("e").className).toContain("ui-empty--compact");
    expect(container.querySelector("code")?.textContent).toBe("detail");
  });
});

describe("StatStrip / Table / Callout / KeyValue / PageHeader", () => {
  it("StatStrip is a labelled group of stats", () => {
    render(
      <StatStrip aria-label="Resumen">
        <Stat label="A" value={1} />
        <Stat label="B" value={2} />
      </StatStrip>,
    );
    const g = screen.getByRole("group", { name: "Resumen" });
    expect(within(g).getByText("A").nextSibling?.textContent).toBe("1");
  });

  it("Table scrolls inside its wrapper and supports dense", () => {
    const { container } = render(<Table dense aria-label="t"><tbody><tr><td>x</td></tr></tbody></Table>);
    expect(container.querySelector(".ui-table-wrap > table.ui-table.ui-table--dense")).toBeTruthy();
    expect(screen.getByRole("table", { name: "t" })).toBeTruthy();
  });

  it("Callout exposes role, tone and optional icon", () => {
    const { container } = render(<Callout tone="warn" role="alert" icon={<i data-testid="ic" />}>careful</Callout>);
    expect(screen.getByRole("alert").className).toContain("tone-warn");
    expect(container.querySelector(".ui-callout__icon [data-testid=ic]")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("careful");
  });

  it("KeyValue lists label/value pairs with a mono value and optional tone", () => {
    const { container } = render(
      <KeyValue>
        <KV label="Temp" tone="warn">80 °C</KV>
      </KeyValue>,
    );
    expect(container.querySelector("dl.ui-kv")).toBeTruthy();
    expect(container.querySelector("dd")!.className).toContain("num");
    expect(container.querySelector(".ui-kv__item")!.className).toContain("tone-warn");
  });

  it("PageHeader renders the single h1 with an optional id and subtitle", () => {
    render(<PageHeader title="Machines" titleId="t" subtitle="6 machines" />);
    const h = screen.getByRole("heading", { level: 1, name: "Machines" });
    expect(h.id).toBe("t");
    expect(screen.getByText("6 machines")).toBeTruthy();
  });
});

describe("more tone mappers", () => {
  it("map thread and service states", () => {
    expect(toneForThreadState("active")).toBe("ok");
    expect(toneForThreadState("waiting")).toBe("warn");
    expect(toneForThreadState("idle")).toBe("info");
    expect(toneForThreadState("dormant")).toBe("dormant");
    expect(toneForThreadState("archived")).toBe("dormant");
    expect(toneForServiceStatus("up")).toBe("ok");
    expect(toneForServiceStatus("down")).toBe("danger");
    expect(toneForServiceStatus("unknown")).toBe("dormant");
  });
});
