/**
 * list.ts — handleList for the disc MCP server.
 *
 * Lists channels in a guild, filtered by type and sorted by position.
 * Format per line: #name (id)
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
  position: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_MAP: Record<string, number> = {
  text: 0,
  voice: 2,
  category: 4,
};

const DEFAULT_TYPE = "text";

// ---------------------------------------------------------------------------
// handleList
// ---------------------------------------------------------------------------

/**
 * Handle a disc_list tool call.
 *
 * @param params  Tool parameters: guild_id (required), type (optional, default "text")
 * @returns       Formatted channel list or error message
 */
export async function handleList(
  params: Record<string, unknown>
): Promise<string> {
  // Check kill switch
  const kill = checkKillSwitch();
  if (kill.active) {
    return killError(kill);
  }

  // Extract and validate guild_id
  const guild_id = params.guild_id;
  if (typeof guild_id !== "string" || guild_id.trim() === "") {
    return "Error: guild_id is required";
  }

  // Extract and resolve type
  const typeStr =
    typeof params.type === "string" ? params.type : DEFAULT_TYPE;
  const typeInt = TYPE_MAP[typeStr];
  if (typeInt === undefined) {
    return `Error: unknown type "${typeStr}" — must be text, voice, or category`;
  }

  // GET /guilds/{guild_id}/channels
  const result = await discordFetch<DiscordChannel[]>(
    `/guilds/${guild_id}/channels`
  );

  if (!result.ok) {
    return `Error: ${result.error}`;
  }

  const channels = result.data;

  // Filter by type, then sort by position
  const filtered = channels
    .filter((ch) => ch.type === typeInt)
    .sort((a, b) => a.position - b.position);

  if (filtered.length === 0) {
    return "No channels found";
  }

  return filtered.map((ch) => `#${ch.name} (${ch.id})`).join("\n");
}
