import type { HubSnapshot, WorkSnapshot } from "@fhub/core";
import type { Tone } from "../components/tone.ts";
import type { RouteDef } from "../routes.tsx";

export interface NavBadge {
  count: number;
  tone: Tone;
  /** Screen-reader / tooltip text, e.g. "offline". */
  label: string;
}

/**
 * Attention counts for the sidebar, derived from the snapshot (undefined entry = nothing to flag):
 * work items waiting on Facundo, machines offline (else degraded), accounts in cooldown/error, proxy errors in the last hour,
 * secrets expiring/expired/invalid.
 */
export function deriveNavBadges(snapshot: HubSnapshot | null, work: WorkSnapshot | null = null): Partial<Record<RouteDef["id"], NavBadge>> {
  const out: Partial<Record<RouteDef["id"], NavBadge>> = {};
  const waiting = work?.waiting.length ?? 0;
  if (waiting > 0) out.work = { count: waiting, tone: "warn", label: "te esperan" };
  if (!snapshot) return out;

  const offline = snapshot.machines.filter((m) => m.status === "offline").length;
  const degraded = snapshot.machines.filter((m) => m.status === "degraded").length;
  if (offline > 0) out.machines = { count: offline, tone: "danger", label: "offline" };
  else if (degraded > 0) out.machines = { count: degraded, tone: "warn", label: "degraded" };

  const cooldown = snapshot.accounts.filter((a) => a.poolState === "cooldown").length;
  const errored = snapshot.accounts.filter((a) => a.poolState === "error").length;
  if (cooldown + errored > 0) {
    out.subscriptions = {
      count: cooldown + errored,
      tone: errored > 0 ? "danger" : "warn",
      label: errored > 0 ? "en cooldown o con error" : "en cooldown",
    };
  }

  const errors = snapshot.proxy?.lastHour.errors ?? 0;
  if (errors > 0) out.proxy = { count: errors, tone: "warn", label: "errores en la última hora" };

  const bad = snapshot.secrets.filter((s) => s.status === "expired" || s.status === "invalid").length;
  const expiring = snapshot.secrets.filter((s) => s.status === "expiring").length;
  if (bad + expiring > 0) {
    out.secrets = {
      count: bad + expiring,
      tone: bad > 0 ? "danger" : "warn",
      label: bad > 0 ? "por vencer o inválidos" : "por vencer",
    };
  }
  return out;
}
