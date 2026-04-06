/**
 * resolve.ts — handleResolve for the disc MCP server.
 *
 * Resolves a channel name to its ID within a guild.
 * Normalizes input: strips leading '#', lowercases before comparison.
 */

import { discordFetch } from "./api.ts";
import { checkKillSwitch, killError } from "./kill.ts";

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
  // Check kill switch
  const kill = checkKillSwitch();
  if (kill.active) {
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
    return `Error: ${result.error}`;
  }

  const channels = result.data;

  // Find the matching channel (case-insensitive, # stripped)
  const match = channels.find(
    (channel) => channel.name.toLowerCase() === normalizedName
  );

  if (!match) {
    return `Channel '#${normalizedName}' not found in guild`;
  }

  return match.id;
}
