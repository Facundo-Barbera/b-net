/**
 * Board configuration: who is an admin, which bots exist, which projects each one may touch and where
 * its webhook lives. It comes from a JSON file OUTSIDE the repo (HUB_BOARD_CONFIG_FILE), so URLs and
 * secrets never land in Git; secrets themselves are referenced by file path or env var name, never inline.
 *
 *   {
 *     "admins": ["facundo@example.invalid"],
 *     "bots": {
 *       "orquestador": { "projects": ["*"] },
 *       "fstack-vps":  { "projects": ["b-net"], "webhook": { "url": "http://127.0.0.1:8799/bnet-webhook", "secretFile": "/etc/b-net/webhooks/fstack-vps" } }
 *     }
 *   }
 */
import { z } from "zod";
import { BOARD_BASE_PATH, ProjectId } from "@b-net/core";
import { ConfigError, type ReadTextFile } from "../config.ts";

/** Where events go when a bot has no webhook of its own: the local test sink (scripts/webhook-sink.ts). */
export const DEFAULT_WEBHOOK_URL = "http://127.0.0.1:8799/bnet-webhook";

/**
 * Bot names become Board principal ids `bnet:bot:<name>`, and Board matches a person's grants by the
 * id's third segment. Logins always contain "@", so a bot name (no "@") can never collide with an admin.
 */
export const BoardBotName = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "a-z, 0-9, '-' (max 32, starts with a letter)");

/** A Tailscale login as `tailscale serve` sends it (`user@github`, `ada@example.com`). */
export const TailnetLogin = z.string().regex(/^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,190}$/, "a Tailscale login (user@domain)");

const WebhookUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((u) => !new URL(u).username && !new URL(u).password, "no credentials in the URL; use secretFile or secretEnv");

const Webhook = z
  .object({
    url: WebhookUrl,
    /** File holding the HMAC secret (systemd LoadCredential works). Wins over secretEnv. */
    secretFile: z.string().min(1).optional(),
    /** Name of an env var holding the HMAC secret. */
    secretEnv: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).optional(),
  })
  .strict();

const BotEntry = z
  .object({
    /** Project ids, or ["*"] for every channel (a publisher such as the orchestrator; it gets no webhooks). */
    projects: z.array(z.union([z.literal("*"), ProjectId])).min(1).max(64),
    webhook: Webhook.optional(),
  })
  .strict();

const BoardConfigFile = z
  .object({
    admins: z.array(TailnetLogin).max(16).default([]),
    bots: z.record(BoardBotName, BotEntry).default({}),
  })
  .strict();

export interface BoardBot {
  name: string;
  projects: string[];
  webhook: { url: string; secret: string | null } | null;
}

export interface BoardConfig {
  /** Public URL of the mount (token audience), e.g. https://<host>.tail0fake.ts.net/api/board. */
  url: string;
  /** Host part of `url`: the only Host a trusted Tailscale login is accepted for. */
  publicHost: string;
  /** Lowercased admin logins. */
  admins: ReadonlySet<string>;
  bots: BoardBot[];
  /** 127.0.0.1 port that `tailscale serve` forwards to; 0 = no loopback listener (then no admin login works). */
  servePort: number;
  defaultWebhookUrl: string;
}

const intIn = (v: string | undefined, def: number, min: number, max: number, name: string) => {
  if (v === undefined || v.trim() === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be an integer in [${min}, ${max}]`);
  return n;
};

function secretOf(w: z.infer<typeof Webhook>, env: Record<string, string | undefined>, read: ReadTextFile, bot: string): string | null {
  if (w.secretFile) {
    try {
      return read(w.secretFile).trim() || null;
    } catch {
      throw new ConfigError(`board config: cannot read the webhook secretFile of bot ${bot}`);
    }
  }
  if (w.secretEnv) return env[w.secretEnv]?.trim() || null;
  return null;
}

/**
 * Null when the board is off (no HUB_BOARD_URL). Errors name the offending field, never a secret or URL value.
 */
export function loadBoardConfig(env: Record<string, string | undefined>, read: ReadTextFile): BoardConfig | null {
  const rawUrl = env.HUB_BOARD_URL?.trim();
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError("HUB_BOARD_URL is not a URL");
  }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new ConfigError("HUB_BOARD_URL must be https (the tailscale serve name), or localhost for tests");
  if (url.pathname.replace(/\/+$/, "") !== BOARD_BASE_PATH) throw new ConfigError(`HUB_BOARD_URL must end with ${BOARD_BASE_PATH}`);

  let parsed: z.infer<typeof BoardConfigFile> = { admins: [], bots: {} };
  const file = env.HUB_BOARD_CONFIG_FILE?.trim();
  if (file) {
    let raw: unknown;
    try {
      raw = JSON.parse(read(file));
    } catch {
      throw new ConfigError("cannot read/parse HUB_BOARD_CONFIG_FILE");
    }
    const r = BoardConfigFile.safeParse(raw);
    if (!r.success) {
      const i = r.error.issues[0];
      throw new ConfigError(`board config invalid at ${i?.path.join(".") || "(root)"}: ${i?.message ?? ""}`);
    }
    parsed = r.data;
  }

  const defaultWebhookUrl = env.HUB_WEBHOOK_DEFAULT_URL?.trim() || DEFAULT_WEBHOOK_URL;
  if (!WebhookUrl.safeParse(defaultWebhookUrl).success) throw new ConfigError("HUB_WEBHOOK_DEFAULT_URL must be an http(s) URL without credentials");

  const bots: BoardBot[] = Object.entries(parsed.bots).map(([name, b]) => ({
    name,
    projects: [...new Set(b.projects)],
    webhook: b.webhook ? { url: b.webhook.url, secret: secretOf(b.webhook, env, read, name) } : null,
  }));

  return {
    url: `${url.origin}${BOARD_BASE_PATH}`,
    publicHost: url.host,
    admins: new Set(parsed.admins.map((a) => a.toLowerCase())),
    bots,
    servePort: intIn(env.HUB_SERVE_PORT, 8779, 0, 65535, "HUB_SERVE_PORT"),
    defaultWebhookUrl,
  };
}
