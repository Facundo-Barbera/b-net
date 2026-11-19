import type { Tone } from "./tone.ts";

/**
 * Shape per tone, so a status reads without color (Facundo is colour-blind):
 * ok ● circle · warn ▲ triangle · danger ■ square · info ◆ diamond · idle ‖ pause · dormant ○ ring.
 * accent and neutral are not statuses and share the plain circle.
 */
export type ToneShape = "circle" | "triangle" | "square" | "diamond" | "pause" | "ring";

export const TONE_SHAPE: Record<Tone, ToneShape> = {
  ok: "circle",
  warn: "triangle",
  danger: "square",
  info: "diamond",
  idle: "pause",
  dormant: "ring",
  accent: "circle",
  neutral: "circle",
};

/**
 * SVG children for a tone's shape in a 10×10 box, filled with currentColor. Used by `StatusDot`
 * and directly inside larger SVGs (topology nodes) through a `<g transform>`.
 */
export function ToneGlyph({ tone }: { tone: Tone }) {
  switch (TONE_SHAPE[tone]) {
    case "triangle":
      return <path d="M5 0.6 9.6 9.2H0.4Z" />;
    case "square":
      return <rect x="1" y="1" width="8" height="8" rx="1" />;
    case "diamond":
      return <path d="M5 0.3 9.7 5 5 9.7 0.3 5Z" />;
    case "pause":
      return (
        <>
          <rect x="1.5" y="1" width="2.6" height="8" rx="0.6" />
          <rect x="5.9" y="1" width="2.6" height="8" rx="0.6" />
        </>
      );
    case "ring":
      return <circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" />;
    default:
      return <circle cx="5" cy="5" r="4.2" />;
  }
}
