import type { MachineView, AccountView, SecretMeta, T3ThreadView } from "@bixku/core";
import { USAGE_DANGER_AT, USAGE_WARN_AT } from "../lib/thresholds.ts";

type ServiceProbe = MachineView["services"][number];

/** Semantic color of a status. Maps 1:1 to CSS classes `tone-*` (see styles/components.css). */
export type Tone = "ok" | "warn" | "danger" | "info" | "idle" | "dormant" | "accent" | "neutral";

/** online → ok, degraded → warn, offline → danger, paused → idle, unknown → dormant. */
export function toneForMachineStatus(status: MachineView["status"]): Tone {
  switch (status) {
    case "online": return "ok";
    case "degraded": return "warn";
    case "offline": return "danger";
    case "paused": return "idle";
    default: return "dormant";
  }
}

/** active → ok, standby → idle, cooldown → warn, error → danger, disabled → dormant. */
export function toneForPoolState(state: AccountView["poolState"]): Tone {
  switch (state) {
    case "active": return "ok";
    case "standby": return "idle";
    case "cooldown": return "warn";
    case "error": return "danger";
    default: return "dormant";
  }
}

/** ok → ok, expiring → warn, expired/invalid → danger, unknown → dormant. */
export function toneForSecretStatus(status: SecretMeta["status"]): Tone {
  switch (status) {
    case "ok": return "ok";
    case "expiring": return "warn";
    case "expired":
    case "invalid": return "danger";
    default: return "dormant";
  }
}

/** active → ok, waiting → warn, idle → info, dormant/archived → dormant. */
export function toneForThreadState(state: T3ThreadView["state"]): Tone {
  switch (state) {
    case "active": return "ok";
    case "waiting": return "warn";
    case "idle": return "info";
    default: return "dormant";
  }
}

/** up → ok, down → danger, unknown → dormant. */
export function toneForServiceStatus(status: ServiceProbe["status"]): Tone {
  return status === "up" ? "ok" : status === "down" ? "danger" : "dormant";
}

/** Meter color from a 0–100 value: >= dangerAt → danger, >= warnAt → warn, else ok. Defaults: lib/thresholds. */
export function meterTone(value: number, warnAt = USAGE_WARN_AT, dangerAt = USAGE_DANGER_AT): Tone {
  return value >= dangerAt ? "danger" : value >= warnAt ? "warn" : "ok";
}
