import type { HubSnapshot } from "@bixku/core";
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
 * machines offline (else degraded), accounts in cooldown/error, proxy errors in the last hour,
 * secrets expiring/expired/invalid.
 */
export function deriveNavBadges(snapshot: HubSnapshot | null): Partial<Record<RouteDef["id"], NavBadge>> {
  if (!snapshot) return {};
  const out: Partial<Record<RouteDef["id"], NavBadge>> = {};

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
      label: errored > 0 ? "in cooldown or error" : "in cooldown",
    };
  }

  const errors = snapshot.proxy?.lastHour.errors ?? 0;
  if (errors > 0) out.proxy = { count: errors, tone: "warn", label: "errors in the last hour" };

  const bad = snapshot.secrets.filter((s) => s.status === "expired" || s.status === "invalid").length;
  const expiring = snapshot.secrets.filter((s) => s.status === "expiring").length;
  if (bad + expiring > 0) {
    out.secrets = {
      count: bad + expiring,
      tone: bad > 0 ? "danger" : "warn",
      label: bad > 0 ? "expiring or invalid" : "expiring",
    };
  }
  return out;
}
