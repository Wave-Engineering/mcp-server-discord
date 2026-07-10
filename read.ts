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
import { sanitizeSurrogates } from "./sanitize.ts";

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
const SNOWFLAKE_RE = /^\d+$/;

/**
 * Format one Discord message as a digest line: `[{ISO timestamp}] <{user}>: {content}`.
 * Author name and content are surrogate-sanitized: a lone surrogate in a pulled
 * message would 400 the reader's own next request once it lands in the transcript
 * (see sanitize.ts).
 */
function formatMessage(msg: DiscordMessage): string {
  return `[${msg.timestamp}] <${sanitizeSurrogates(msg.author.username)}>: ${sanitizeSurrogates(msg.content)}`;
}

/**
 * Handle a disc_read tool call.
 *
 * @param params  Tool parameters: channel_id (required), limit and message_id (optional)
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

  // Optional single-message fetch by (channel, msgid). When message_id is
  // supplied, fetch exactly that message via GET /channels/{id}/messages/{msgid}
  // (a single object, not a list) and return its one formatted line. This is the
  // (channel, msgid) single-fetch primitive #66 adds — the prerequisite for
  // `disc forward` (#68), which receives a doorbell (channel_id, message_id) and
  // needs the FULL message content, not the recent-list digest. `limit` is
  // irrelevant here and ignored.
  const rawMessageId = params.message_id;
  if (rawMessageId !== undefined && rawMessageId !== null && String(rawMessageId).trim() !== "") {
    const message_id = String(rawMessageId).trim();
    if (!SNOWFLAKE_RE.test(message_id)) {
      return `Error: message_id must be a Discord snowflake (digits only), got "${message_id}"`;
    }
    const single = await discordFetch<DiscordMessage>(
      `/channels/${channel_id}/messages/${message_id}`
    );
    if (!single.ok) {
      const ms = Date.now() - startMs;
      log.warn("tool_call", { tool: "disc_read", ok: false, ms, error: single.error });
      return `Error: ${single.error}`;
    }
    const ms = Date.now() - startMs;
    log.info("tool_call", { tool: "disc_read", ok: true, ms, messages: 1, message_id });
    return formatMessage(single.data);
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

  const lines = chronological.map(formatMessage);

  const ms = Date.now() - startMs;
  log.info("tool_call", { tool: "disc_read", ok: true, ms, messages: messages.length });
  return lines.join("\n");
}
