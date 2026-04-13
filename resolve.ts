/**
 * resolve.ts — handleResolve for the disc MCP server.
 *
 * Resolves a channel name to its ID within a guild.
 * Normalizes input: strips leading '#', lowercases before comparison.
 */

import { discordFetch } from "./api.ts";
import { checkKillSwitch, killError } from "./kill.ts";
import { log } from "./logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

// ---------------------------------------------------------------------------
// handleResolve
// ---------------------------------------------------------------------------

/**
 * Handle a disc_resolve tool call.
 *
 * @param params  Tool parameters: name (required), guild_id (required)
 * @returns       Channel ID string on match, or descriptive error string
 */
export async function handleResolve(
  params: Record<string, unknown>
): Promise<string> {
  const startMs = Date.now();

  // Check kill switch
  const kill = checkKillSwitch();
  if (kill.active) {
    log.warn("tool_call", { tool: "disc_resolve", ok: false, ms: 0, error: "kill_switch_active" });
    return killError(kill);
  }

  // Extract params — tool schema uses "name" and "guild_id"
  const name = params.name as string;
  const guild_id = params.guild_id as string;

  // Normalize: strip leading '#' and lowercase
  const normalizedName = name.replace(/^#/, "").toLowerCase();

  // GET /guilds/{guild_id}/channels
  const result = await discordFetch<DiscordChannel[]>(
    `/guilds/${guild_id}/channels`
  );

  if (!result.ok) {
    const ms = Date.now() - startMs;
    log.warn("tool_call", { tool: "disc_resolve", ok: false, ms, error: result.error });
    return `Error: ${result.error}`;
  }

  const channels = result.data;

  // Find the matching channel (case-insensitive, # stripped)
  const match = channels.find(
    (channel) => channel.name.toLowerCase() === normalizedName
  );

  if (!match) {
    const ms = Date.now() - startMs;
    log.warn("tool_call", { tool: "disc_resolve", ok: false, ms, error: "channel_not_found" });
    return `Channel '#${normalizedName}' not found in guild`;
  }

  const ms = Date.now() - startMs;
  log.info("tool_call", { tool: "disc_resolve", ok: true, ms });
  return match.id;
}
