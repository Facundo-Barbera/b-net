/**
 * Engine configuration for Board inside the hub. Only what the engine needs: the public URL of the mount,
 * which is every token's audience and the URL clients discover. Who may call it (admins, bot tokens) and
 * where events go (webhooks) are configured by the access and events modules that plug into the engine.
 */
import { BOARD_BASE_PATH } from "@fhub/core";
import { ConfigError } from "../config.ts";

/** What the hub serves the UI from Board (BoardProjectsResponse). Here, not in core's API routes, until the UI branch adopts it. */
export const BOARD_PROJECTS_ROUTE = "/api/v1/board/projects";

export interface BoardConfig {
  /** Public URL of the mount, e.g. https://<host>.tail0fake.ts.net/api/board (the `tailscale serve` name). */
  url: string;
  /** Host part of `url`. */
  publicHost: string;
}

/** Null when the board is off (no HUB_BOARD_URL). Errors name the variable, never its value. */
export function loadBoardConfig(env: Record<string, string | undefined>): BoardConfig | null {
  const raw = env.HUB_BOARD_URL?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("HUB_BOARD_URL is not a URL");
  }
  // Board checks token audiences against this URL; a plain-http public name would let anyone on the path replay them.
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new ConfigError("HUB_BOARD_URL must be https (the tailscale serve name), or localhost for tests");
  if (url.pathname.replace(/\/+$/, "") !== BOARD_BASE_PATH) throw new ConfigError(`HUB_BOARD_URL must end with ${BOARD_BASE_PATH}`);
  return { url: `${url.origin}${BOARD_BASE_PATH}`, publicHost: url.host };
}
