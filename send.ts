/**
 * send.ts — handleSend: primary outbound tool for disc_send.
 *
 * Handles:
 *  - Kill switch check
 *  - Message splitting into ≤2000-char chunks with (1/N) prefixes
 *  - Optional embed (format "title:body")
 *  - Optional file attachment via multipart FormData on the last chunk
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { getToken } from "./config.ts";
import { getDiscordBase, resolveApiBase } from "./api.ts";
import { discordFetch } from "./api.ts";
import { checkKillSwitch, killError } from "./kill.ts";
import { log } from "./logger.ts";

const MAX_CHUNK = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendParams {
  channel_id: string;
  message: string;
  embed?: string;
  attach_path?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Split `text` into chunks of ≤ maxLen characters on word boundaries
 * (falls back to hard-split if a single word exceeds maxLen).
 */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    // Try to split at the last space within maxLen
    let splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt <= 0) {
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^ /, "");
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

/**
 * Parse an embed string of the form "title:body" (split on first colon only).
 */
function parseEmbed(embed: string): { title: string; description: string } {
  const colonIdx = embed.indexOf(":");
  if (colonIdx === -1) {
    return { title: embed, description: "" };
  }
  return {
    title: embed.slice(0, colonIdx),
    description: embed.slice(colonIdx + 1),
  };
}

// ---------------------------------------------------------------------------
// handleSend
// ---------------------------------------------------------------------------

export async function handleSend(
  params: Record<string, unknown>
): Promise<string> {
  const startMs = Date.now();
  const channel_id = params.channel_id as string;
  const message = params.message as string;
  const embed = params.embed as string | undefined;
  const attach_path = params.attach_path as string | undefined;

  // Kill switch check
  const killState = checkKillSwitch();
  if (killState.active) {
    log.warn("tool_call", { tool: "disc_send", ok: false, ms: 0, error: "kill_switch_active" });
    return killError(killState);
  }

  // Split message into chunks, accounting for label overhead
  // First, do a tentative split to count how many chunks we'll need
  const tentativeChunks = splitMessage(message, MAX_CHUNK);

  let labeledChunks: string[];
  let n: number; // Total number of chunks (for return message)

  if (tentativeChunks.length === 1) {
    // Single chunk — no labels needed, use as-is
    labeledChunks = tentativeChunks;
    n = 1;
  } else {
    // Multiple chunks — need to add labels like "(1/N) ", "(2/N) ", etc.
    // Label format: "(N/M) " where N and M can grow with message size
    // Worst case up to 999 chunks: "(999/999) " = 11 chars
    // Use 12 chars to include safety margin
    const LABEL_OVERHEAD = 12;

    // Re-split with reduced maxLen to ensure labeled chunks fit under MAX_CHUNK
    const rawChunks = splitMessage(message, MAX_CHUNK - LABEL_OVERHEAD);
    n = rawChunks.length;
    labeledChunks = rawChunks.map((chunk, i) => `(${i + 1}/${n}) ${chunk}`);
  }

  // Send all chunks except the last via plain JSON
  for (let i = 0; i < labeledChunks.length - 1; i++) {
    const result = await discordFetch(`/channels/${channel_id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: labeledChunks[i] }),
    });
    if (!result.ok) {
      const ms = Date.now() - startMs;
      log.warn("tool_call", { tool: "disc_send", ok: false, ms, error: result.error });
      return `Error sending chunk ${i + 1}/${n}: ${result.error}`;
    }
  }

  // Send the last chunk — may include embed and/or attachment
  const lastChunk = labeledChunks[labeledChunks.length - 1];

  if (attach_path) {
    // Multipart FormData for attachment
    const token = getToken();
    const fileBytes = readFileSync(attach_path);
    const fileName = basename(attach_path);

    const form = new FormData();

    const payload: Record<string, unknown> = { content: lastChunk };
    if (embed) {
      const { title, description } = parseEmbed(embed);
      payload.embeds = [{ title, description }];
    }

    form.append(
      "payload_json",
      new Blob([JSON.stringify(payload)], { type: "application/json" }),
      "payload.json"
    );
    form.append("files[0]", new Blob([fileBytes]), fileName);

    let response: Response;
    const attachStartMs = Date.now();
    try {
      await resolveApiBase();
      response = await fetch(`${getDiscordBase()}/channels/${channel_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${token}` },
        body: form,
      });
    } catch (err) {
      const attachMs = Date.now() - attachStartMs;
      log.error("api_call", { method: "POST", endpoint: `/channels/${channel_id}/messages`, status: 0, ms: attachMs, service: "discord" }, err instanceof Error ? err.message : String(err));
      const ms = Date.now() - startMs;
      log.warn("tool_call", { tool: "disc_send", ok: false, ms, error: `Network error: ${err instanceof Error ? err.message : String(err)}` });
      return `Network error: ${err instanceof Error ? err.message : String(err)}`;
    }

    const attachMs = Date.now() - attachStartMs;
    if (!response.ok) {
      log.error("api_call", { method: "POST", endpoint: `/channels/${channel_id}/messages`, status: response.status, ms: attachMs, service: "discord" });
      const body = await response.text().catch(() => "");
      const ms = Date.now() - startMs;
      log.warn("tool_call", { tool: "disc_send", ok: false, ms, error: `HTTP ${response.status}: ${body}`.trim() });
      return `Error sending attachment: HTTP ${response.status}: ${body}`.trim();
    }

    log.info("api_call", { method: "POST", endpoint: `/channels/${channel_id}/messages`, status: response.status, ms: attachMs, service: "discord" });
    const ms = Date.now() - startMs;
    log.info("tool_call", { tool: "disc_send", ok: true, ms, chunks: n });
    return `Message sent to ${channel_id} (${n} chunk${n !== 1 ? "s" : ""}, with attachment)`;
  }

  // Plain JSON last chunk (possibly with embed)
  const body: Record<string, unknown> = { content: lastChunk };
  if (embed) {
    const { title, description } = parseEmbed(embed);
    body.embeds = [{ title, description }];
  }

  const result = await discordFetch(`/channels/${channel_id}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result.ok) {
    const ms = Date.now() - startMs;
    log.warn("tool_call", { tool: "disc_send", ok: false, ms, error: result.error });
    return `Error sending message: ${result.error}`;
  }

  const ms = Date.now() - startMs;
  log.info("tool_call", { tool: "disc_send", ok: true, ms, chunks: n });
  return `Message sent to ${channel_id} (${n} chunk${n !== 1 ? "s" : ""})`;
}
