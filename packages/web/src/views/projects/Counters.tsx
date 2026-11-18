import type { ProjectWork } from "@b-net/core";
import { StatusDot } from "../../components/index.ts";

/** Counter with its word, faint at zero; the waiting/running ones carry their status glyph too. */
export function Counter({ n, label, tone }: { n: number; label: string; tone?: "warn" | "ok" }) {
  return (
    <span className="pj-counter" data-zero={n === 0 || undefined}>
      {tone && n > 0 && <StatusDot tone={tone} />}
      <span className="num pj-counter__n">{n}</span> {label}
    </span>
  );
}

export function Counters({ p }: { p: ProjectWork }) {
  const c = p.counts;
  return (
    <span className="pj-counters">
      <Counter n={c.waiting} label="en espera" tone="warn" />
      <Counter n={c.running} label="en curso" tone="ok" />
      <Counter n={c.threads} label={c.threads === 1 ? "hilo" : "hilos"} />
      <Counter n={c.prs} label={c.prs === 1 ? "PR" : "PRs"} />
      <Counter n={c.deliverables} label={c.deliverables === 1 ? "entregable" : "entregables"} />
    </span>
  );
}
