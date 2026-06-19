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
import { getToken, getConfigValue } from "./config.ts";
import { readAgentIdentity, webhookUsername, webhookAvatarUrl } from "./identity.ts";
import { executeWebhook } from "./webhook.ts";
import { getDiscordBase, resolveApiBase } from "./api.ts";
import { discordFetch } from "./api.ts";
import { resolveChannelId } from "./channel.ts";
import { checkKillSwitch, killError } from "./kill.ts";
import { log } from "./logger.ts";
import { sanitizeSurrogates } from "./sanitize.ts";

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
  const rawChannel = params.channel_id as string;
  const channel_id = resolveChannelId(rawChannel);
  if (!channel_id) {
    return `Error: unknown channel "${rawChannel}" — not found in ~/.claude/discord.json channels map`;
  }
  // Accept `content` as alias for `message`. The upstream Discord REST API
  // uses `content`, so it's the dominant convention agents guess. The schema
  // continues to advertise `message` as canonical; alias is for tolerance.
  const message = (params.message ?? params.content) as string | undefined;
  if (typeof message !== "string" || message.length === 0) {
    const received = Object.keys(params).join(", ") || "no fields";
    const err = `Error: missing required field 'message' (received: ${received}). Accepted aliases: 'content'.`;
    log.warn("tool_call", { tool: "disc_send", ok: false, ms: Date.now() - startMs, error: "missing_message_field" });
    return err;
  }
  const embed = params.embed as string | undefined;
  const attach_path = params.attach_path as string | undefined;

  // Kill switch check
  const killState = checkKillSwitch();
  if (killState.active) {
    log.warn("tool_call", { tool: "disc_send", ok: false, ms: 0, error: "kill_switch_active" });
    return killError(killState);
  }

  // Sanitize outbound: never emit a lone surrogate that would jam another
  // agent's session once it lands in their transcript (see sanitize.ts).
  // Done before chunking so every part is clean.
  const safeMessage = sanitizeSurrogates(message);

  // Split message into chunks, accounting for label overhead
  // First, do a tentative split to count how many chunks we'll need
  const tentativeChunks = splitMessage(safeMessage, MAX_CHUNK);

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
    const rawChunks = splitMessage(safeMessage, MAX_CHUNK - LABEL_OVERHEAD);
    n = rawChunks.length;
    labeledChunks = rawChunks.map((chunk, i) => `(${i + 1}/${n}) ${chunk}`);
  }

  // Belt-and-suspenders: re-sanitize each final chunk. splitMessage slices on
  // UTF-16 code units, so a valid surrogate pair straddling a chunk boundary
  // would otherwise re-introduce lone halves AFTER the message-level sanitize.
  // (No length impact — a lone surrogate → U+FFFD is one code unit either way.)
  labeledChunks = labeledChunks.map(sanitizeSurrogates);

  // Webhook identity path (#55): post as the agent's own username + avatar so a
  // human juggling many agents can tell them apart. Gated behind config; skips
  // when no /name identity exists or an attachment is present (attachments stay
  // on the bot path for now). Text stays in `content` — agents read it normally.
  const identity = readAgentIdentity();
  const webhookFlag =
    getConfigValue("webhook_identity", "DISC_WEBHOOK_IDENTITY", "") !== "";
  // Empty/whitespace-only names (after sanitize + banned-substring neutralization)
  // would make Discord reject the webhook execute — fall back to the bot path.
  const username = identity ? sanitizeSurrogates(webhookUsername(identity)) : "";
  if (webhookFlag && identity && username.length > 0 && !attach_path) {
    const avatarUrl = webhookAvatarUrl(
      identity.dev_name,
      getConfigValue("webhook_avatar_style", "DISC_WEBHOOK_AVATAR_STYLE", "bottts")
    );
    let embeds: unknown[] | undefined;
    if (embed) {
      const { title, description } = parseEmbed(sanitizeSurrogates(embed));
      embeds = [{ title, description }];
    }
    for (let i = 0; i < labeledChunks.length; i++) {
      const isLast = i === labeledChunks.length - 1;
      const res = await executeWebhook(channel_id, {
        username,
        avatarUrl,
        content: labeledChunks[i],
        embeds: isLast ? embeds : undefined,
      });
      if (!res.ok) {
        const ms = Date.now() - startMs;
        log.warn("tool_call", { tool: "disc_send", ok: false, ms, error: res.error });
        return `Error sending chunk ${i + 1}/${n} via webhook: ${res.error}`;
      }
    }
    const ms = Date.now() - startMs;
    log.info("tool_call", { tool: "disc_send", ok: true, ms, chunks: n, identity: identity.dev_name });
    return `Message sent to ${channel_id} as ${username} (${n} chunk${n !== 1 ? "s" : ""})`;
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
    const fileName = sanitizeSurrogates(basename(attach_path));

    const form = new FormData();

    const payload: Record<string, unknown> = { content: lastChunk };
    if (embed) {
      const { title, description } = parseEmbed(sanitizeSurrogates(embed));
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
    const { title, description } = parseEmbed(sanitizeSurrogates(embed));
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
