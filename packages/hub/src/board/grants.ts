/**
 * Keeps one Board grant per bot that matches the config: `*` closed, and read/post/react/label in each
 * of its projects' subtrees (`<project>/`). Runs at startup with the hub's own handle (Board's own code,
 * which may manage grants). Idempotent: an existing grant with the same `can` is left alone.
 *
 * Why `*` must be closed explicitly: bots are "person" principals (see auth.ts), and every person gets
 * Board's g1 (`all-users`, everything at `*`). A grant naming the bot alone at `*` is closer than the
 * group, so it wins there, and the bot's project patterns are more specific still.
 */
import type { Board, GrantCan, GrantView } from "@vercel/board";
import type { BoardBot } from "./config.ts";

const BOT_PERMISSIONS = ["read", "post", "react", "label"] as const;

export function desiredCan(projects: readonly string[]): GrantCan {
  if (projects.includes("*")) return { "*": [...BOT_PERMISSIONS] };
  const can: Record<string, readonly (typeof BOT_PERMISSIONS)[number][] | "none"> = { "*": "none" };
  for (const p of projects) can[`${p}/`] = [...BOT_PERMISSIONS];
  return can;
}

/** `can` as comparable data: 'none' and [] are the same, permission order does not matter. */
function normal(can: Readonly<Record<string, "all" | "none" | readonly string[]>>): string {
  const entries = Object.entries(can).map(([k, v]) => [k, v === "none" ? [] : v === "all" ? "all" : [...v].sort()] as const);
  entries.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function namesOnly(g: GrantView, bot: string): boolean {
  const only = g.principals.length === 1 ? g.principals[0] : undefined;
  return only?.kind === "user" && only.userId === bot;
}

export interface GrantSyncResult {
  ready: Set<string>;
  failed: Array<{ bot: string; error: string }>;
}

/** Brings each configured bot's grant in line. A bot whose grant could not be written stays out (not ready). */
export async function syncBotGrants(team: Pick<Board, "grants" | "createGrant" | "updateGrant" | "revokeGrant">, bots: readonly BoardBot[]): Promise<GrantSyncResult> {
  const ready = new Set<string>();
  const failed: GrantSyncResult["failed"] = [];
  const existing = await team.grants();
  for (const bot of bots) {
    const can = desiredCan(bot.projects);
    try {
      const mine = existing.filter((g) => namesOnly(g, bot.name));
      let keep = mine.find((g) => normal(g.can) === normal(can)) ?? mine[0];
      if (!keep) keep = (await team.createGrant({ principals: [{ kind: "user", userId: bot.name }], can })).grant;
      else if (normal(keep.can) !== normal(can)) await team.updateGrant(keep.id, { can });
      // Grants tied at a pattern add up, so a second grant naming the bot (made by hand) could widen it.
      for (const extra of mine) if (extra.id !== keep.id) await team.revokeGrant(extra.id);
      ready.add(bot.name);
    } catch (e) {
      failed.push({ bot: bot.name, error: e instanceof Error ? e.message.slice(0, 200) : "grant write failed" });
    }
  }
  return { ready, failed };
}
