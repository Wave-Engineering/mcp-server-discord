/**
 * create_channel.ts — handleCreateChannel for the disc MCP server.
 *
 * Creates a text channel in a Discord guild with optional topic and category.
 * Name is sanitized: strip '#', replace spaces with '-', lowercase.
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
}

// ---------------------------------------------------------------------------
// handleCreateChannel
// ---------------------------------------------------------------------------

/**
 * Handle a disc_create_channel tool call.
 *
 * @param params  Tool parameters: guild_id (required), name (required),
 *                topic? (optional), category_id? (optional)
 * @returns       Confirmation string or error message
 */
export async function handleCreateChannel(
  params: Record<string, unknown>
): Promise<string> {
  const startMs = Date.now();

  // Check kill switch
  const kill = checkKillSwitch();
  if (kill.active) {
    log.warn("tool_call", { tool: "disc_create_channel", ok: false, ms: 0, error: "kill_switch_active" });
    return killError(kill);
  }

  // Extract and validate guild_id
  const guild_id = params.guild_id;
  if (typeof guild_id !== "string" || guild_id.trim() === "") {
    return "Error: guild_id is required";
  }

  // Extract and validate name
  const rawName = params.name;
  if (typeof rawName !== "string" || rawName.trim() === "") {
    return "Error: name is required";
  }

  // Sanitize name: strip '#', replace spaces with '-', lowercase
  const sanitizedName = rawName
    .replace(/#/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  // Extract optional topic
  const topic =
    typeof params.topic === "string" && params.topic.trim() !== ""
      ? params.topic
      : undefined;

  // Extract optional category_id
  const category_id =
    typeof params.category_id === "string" && params.category_id.trim() !== ""
      ? params.category_id
      : undefined;

  // Build POST payload
  const payload: Record<string, unknown> = {
    name: sanitizedName,
    type: 0,
    ...(topic && { topic }),
    ...(category_id && { parent_id: category_id }),
  };

  // POST /guilds/{guild_id}/channels
  const result = await discordFetch<DiscordChannel>(
    `/guilds/${guild_id}/channels`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );

  if (!result.ok) {
    const ms = Date.now() - startMs;
    log.warn("tool_call", { tool: "disc_create_channel", ok: false, ms, error: result.error });
    return `Error: ${result.error}`;
  }

  const newChannel = result.data;
  const ms = Date.now() - startMs;
  log.info("tool_call", { tool: "disc_create_channel", ok: true, ms });
  return `Created channel #${sanitizedName} (${newChannel.id})`;
}
