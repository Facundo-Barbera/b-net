import { z } from "zod";
import { IsoTime } from "./machines.ts";
import { ProviderId } from "./usage.ts";

/**
 * Metadata about a stored secret. There is deliberately NO field that can hold
 * the value. Anything rendering secrets in the hub uses this type only.
 */
export const SecretMeta = z
  .object({
    id: z.string(),
    kind: z.enum(["oauth-token", "api-key", "client-key", "master-key", "service-password", "service-token"]),
    label: z.string(),
    provider: ProviderId.nullable(),
    accountId: z.string().nullable(),
    storage: z.enum(["encrypted-file", "systemd-creds", "env"]),
    /** Machine where the secret lives (must be bixku-homelab for proxy creds). */
    machineId: z.string(),
    createdAt: IsoTime,
    rotatedAt: IsoTime.nullable(),
    expiresAt: IsoTime.nullable(),
    lastUsedAt: IsoTime.nullable(),
    /** First 8 hex chars of sha256(value) for identification. Never more. */
    fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
    status: z.enum(["ok", "expiring", "expired", "invalid", "unknown"]),
  })
  .strict();
export type SecretMeta = z.infer<typeof SecretMeta>;
