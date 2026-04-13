/**
 * create_thread.ts — handleCreateThread for the disc MCP server.
 *
 * Creates a public thread (type 11) in a Discord channel.
 */

import { discordFetch } from "./api.ts";
import { checkKillSwitch, killError } from "./kill.ts";
import { log } from "./logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiscordThread {
  id: string;
  name: string;
}

// Valid auto_archive_duration values per the Discord API
const VALID_AUTO_ARCHIVE = [60, 1440, 4320, 10080] as const;
type AutoArchiveDuration = (typeof VALID_AUTO_ARCHIVE)[number];

// ---------------------------------------------------------------------------
// handleCreateThread
// ---------------------------------------------------------------------------

/**
 * Handle a disc_create_thread tool call.
 *
 * @param params  Tool parameters: channel_id (required), name (required),
 *                auto_archive? (optional, default 1440)
 * @returns       Confirmation string or error message
 */
export async function handleCreateThread(
  params: Record<string, unknown>
): Promise<string> {
  // Extract and validate channel_id
  const channel_id = params.channel_id;
  if (typeof channel_id !== "string" || channel_id.trim() === "") {
    return "Error: channel_id is required";
  }

  // Extract and validate name
  const name = params.name;
  if (typeof name !== "string" || name.trim() === "") {
    return "Error: name is required";
  }

  // Extract auto_archive with default of 1440
  const rawAutoArchive = params.auto_archive;
  const auto_archive: number =
    rawAutoArchive === undefined ? 1440 : Number(rawAutoArchive);

  // Validate auto_archive is one of the allowed values
  if (!(VALID_AUTO_ARCHIVE as readonly number[]).includes(auto_archive)) {
    return `Error: auto_archive must be one of ${VALID_AUTO_ARCHIVE.join(", ")}`;
  }

  const startMs = Date.now();

  // Check kill switch
  const kill = checkKillSwitch();
  if (kill.active) {
    log.warn("tool_call", { tool: "disc_create_thread", ok: false, ms: 0, error: "kill_switch_active" });
    return killError(kill);
  }

  // POST /channels/{channel_id}/threads
  const result = await discordFetch<DiscordThread>(
    `/channels/${channel_id}/threads`,
    {
      method: "POST",
      body: JSON.stringify({
        name,
        auto_archive_duration: auto_archive as AutoArchiveDuration,
        type: 11,
      }),
    }
  );

  if (!result.ok) {
    const ms = Date.now() - startMs;
    log.warn("tool_call", { tool: "disc_create_thread", ok: false, ms, error: result.error });
    return `Error: ${result.error}`;
  }

  const thread = result.data;
  const ms = Date.now() - startMs;
  log.info("tool_call", { tool: "disc_create_thread", ok: true, ms });
  return `Created thread '${name}' (${thread.id})`;
}
