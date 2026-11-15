import type { MachineView, AccountView, SecretMeta } from "@bixku/core";

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

/** Meter color from a 0–100 value: >= dangerAt → danger, >= warnAt → warn, else ok. */
export function meterTone(value: number, warnAt = 70, dangerAt = 90): Tone {
  return value >= dangerAt ? "danger" : value >= warnAt ? "warn" : "ok";
}
