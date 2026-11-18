/** How each kind of work event reads: word, tone (colour + glyph shape) and icon. Never colour alone. */
import type { ComponentType } from "react";
import type { WorkItem, WorkKind, WorkLink } from "@b-net/core";
import { AlertIcon, CheckIcon, DocIcon, PlayIcon, PullRequestIcon, QuestionIcon, type Tone } from "../../components/index.ts";

export interface KindMeta {
  label: string;
  tone: Tone;
  Icon: ComponentType<{ className?: string }>;
}

export const KIND_META: Record<WorkKind, KindMeta> = {
  needs_input: { label: "Espera tu respuesta", tone: "warn", Icon: QuestionIcon },
  run_failed: { label: "Falló o se interrumpió", tone: "danger", Icon: AlertIcon },
  running: { label: "Corriendo", tone: "ok", Icon: PlayIcon },
  completed: { label: "Terminó", tone: "info", Icon: CheckIcon },
  deliverable: { label: "Entregable", tone: "accent", Icon: DocIcon },
  pr_linked: { label: "PR enlazado", tone: "neutral", Icon: PullRequestIcon },
};

export const LINK_LABEL: Record<WorkLink["kind"], string> = {
  thread: "Abrir en T3",
  pr: "Ver PR",
  deliverable: "Ver entregable",
};

/** Machine display name from the snapshot, falling back to the id. */
export const machineName = (machines: readonly { id: string; name: string }[], id: string | null) =>
  id ? (machines.find((m) => m.id === id)?.name ?? id) : null;

/** External = leaves b-net in a new tab (PRs); t3-thread:// hands off to T3 Code; "#/…" stays in the app. */
export const isExternal = (l: WorkLink) => /^https?:/.test(l.href);

export const linkAria = (item: WorkItem) => (item.link ? `${LINK_LABEL[item.link.kind]}: ${item.title}` : undefined);
