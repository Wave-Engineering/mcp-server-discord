/**
 * read.ts — handleRead for the disc MCP server.
 *
 * Reads recent messages from a Discord channel and returns a formatted digest.
 * Format per line: [ISO timestamp] <username>: content
 * Output is chronological (oldest first — Discord API returns newest first).
 */

import { discordFetch, isScreamHole } from "./api.ts";
import { resolveChannelId } from "./channel.ts";
import { checkKillSwitch, killError } from "./kill.ts";
import { log } from "./logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscordMessage {
  id: string;
  timestamp: string;
  content: string;
  author: {
    id: string;
    username: string;
  };
}

// ---------------------------------------------------------------------------
// handleRead
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Handle a disc_read tool call.
 *
 * @param params  Tool parameters: channel_id (required), limit (optional)
 * @returns       Formatted digest string or error message
 */
export async function handleRead(
  params: Record<string, unknown>
): Promise<string> {
  const startMs = Date.now();

  // Check kill switch
  const kill = checkKillSwitch();
  if (kill.active) {
    log.warn("tool_call", { tool: "disc_read", ok: false, ms: 0, error: "kill_switch_active" });
    return killError(kill);
  }

  // Extract and validate channel_id (accepts snowflake ID or channel name)
  const rawChannel = params.channel_id;
  if (typeof rawChannel !== "string" || rawChannel.trim() === "") {
    return "Error: channel_id is required";
  }
  const channel_id = resolveChannelId(rawChannel);
  if (!channel_id) {
    return `Error: unknown channel "${rawChannel}" — not found in ~/.claude/discord.json channels map`;
  }

  // Extract and clamp limit
  let limit = DEFAULT_LIMIT;
  if (params.limit !== undefined) {
    const raw = Number(params.limit);
    if (!isNaN(raw) && raw > 0) {
      limit = Math.min(Math.floor(raw), MAX_LIMIT);
    }
  }

  // Fetch messages from Discord API
  // Scream-hole requires after=SNOWFLAKE on message reads (returns 400 without it).
  // When routing through scream-hole, always pass after=0 to fetch all cached messages.
  const qs = isScreamHole()
    ? `?limit=${limit}&after=0`
    : `?limit=${limit}`;
  const result = await discordFetch<DiscordMessage[]>(
    `/channels/${channel_id}/messages${qs}`
  );

  if (!result.ok) {
    const ms = Date.now() - startMs;
    log.warn("tool_call", { tool: "disc_read", ok: false, ms, error: result.error });
    return `Error: ${result.error}`;
  }

  const messages = result.data;

  if (!Array.isArray(messages) || messages.length === 0) {
    const ms = Date.now() - startMs;
    log.info("tool_call", { tool: "disc_read", ok: true, ms, messages: 0 });
    return "No messages found";
  }

  // Discord returns newest-first — reverse for chronological output
  const chronological = [...messages].reverse();

  const lines = chronological.map(
    (msg) => `[${msg.timestamp}] <${msg.author.username}>: ${msg.content}`
  );

  const ms = Date.now() - startMs;
  log.info("tool_call", { tool: "disc_read", ok: true, ms, messages: messages.length });
  return lines.join("\n");
}
