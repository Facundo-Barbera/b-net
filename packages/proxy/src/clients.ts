/**
 * Client authentication.
 *
 * Client keys are never stored: config holds `keyHash = hex(HMAC-SHA256(pepper, key))`
 * (HMAC is the standard way to "sha256 + pepper"). The pepper lives in the secret store.
 * Lookup hashes the presented key once and compares it against EVERY stored hash with
 * timingSafeEqual (no early exit), so timing does not reveal which/whether a client matched.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { ClientKeyView } from "@bixku/core";
import type { ClientConfig } from "./config.ts";
import { anyGlob, iso } from "./util.ts";

export function hashClientKey(key: string, pepper: string): string {
  return createHmac("sha256", pepper).update(key, "utf8").digest("hex");
}

/** Generate a new client key (shown once to the operator, then only its hash is kept). */
export function generateClientKey(): string {
  return `bxk-${randomBytes(24).toString("base64url")}`;
}

/** Bearer token or x-api-key (Anthropic SDKs send the latter). */
export function presentedKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1]!.trim();
  }
  const xk = req.headers.get("x-api-key");
  return xk ? xk.trim() : null;
}

export class ClientAuth {
  private readonly clients: ClientConfig[];
  private readonly hashes: Buffer[];
  private readonly pepper: string;
  private readonly lastUsed = new Map<string, number>();

  constructor(clients: ClientConfig[], pepper: string) {
    if (pepper.length < 16) throw new Error("client key pepper must be at least 16 characters");
    this.clients = clients;
    this.pepper = pepper;
    this.hashes = clients.map((c) => Buffer.from(c.keyHash, "hex"));
  }

  authenticate(key: string | null, nowMs: number): ClientConfig | null {
    if (!key) return null;
    const h = Buffer.from(hashClientKey(key, this.pepper), "hex");
    let found: ClientConfig | null = null;
    for (let i = 0; i < this.hashes.length; i++) {
      const eq = timingSafeEqual(h, this.hashes[i]!);
      if (eq && !found) found = this.clients[i]!;
    }
    if (found) this.lastUsed.set(found.id, nowMs);
    return found;
  }

  static allows(client: Pick<ClientConfig, "allowedModels">, model: string): boolean {
    return anyGlob(client.allowedModels, model);
  }

  views(): ClientKeyView[] {
    return this.clients.map((c) => {
      const lu = this.lastUsed.get(c.id);
      return {
        id: c.id,
        label: c.label,
        createdAt: c.createdAt,
        lastUsedAt: lu !== undefined ? iso(lu) : null,
        allowedModels: [...c.allowedModels],
        migration: c.migration,
      };
    });
  }
}
