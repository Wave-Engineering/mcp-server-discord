/**
 * channel.ts — Channel name → ID resolution for the disc MCP server.
 *
 * Accepts either a numeric snowflake ID or a channel name (with optional #
 * prefix). Names are resolved from the `channels` map in ~/.claude/discord.json.
 */

import { loadDiscordConfig } from "./config.ts";

const SNOWFLAKE_RE = /^\d+$/;

/**
 * Resolve a channel identifier to a snowflake ID.
 *
 * - All-digit string → returned as-is (already an ID)
 * - Otherwise → strip leading '#', lowercase, look up in discord.json channels map
 * - Returns null if the name isn't found in the config
 */
export function resolveChannelId(input: string): string | null {
  const trimmed = input.trim();
  if (SNOWFLAKE_RE.test(trimmed)) {
    return trimmed;
  }

  const name = trimmed.replace(/^#/, "").toLowerCase();
  const config = loadDiscordConfig();
  const channels = config.channels as Record<string, string> | undefined;

  if (channels && name in channels) {
    return channels[name];
  }

  return null;
}
