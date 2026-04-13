/**
 * api.ts — Discord REST API client for the disc MCP server.
 *
 * Provides:
 *  - DISCORD_BASE   — Discord API v10 base URL
 *  - discordFetch() — authenticated fetch wrapper with 429/4xx/5xx handling
 */

import { getToken } from "./config.ts";
import { engageKillSwitch } from "./kill.ts";
import { log } from "./logger.ts";

export const DISCORD_BASE = "https://discord.com/api/v10";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiscordResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// discordFetch
// ---------------------------------------------------------------------------

/**
 * Perform an authenticated request to the Discord API.
 *
 * - Injects `Authorization: Bot <token>` header automatically.
 * - On 429: engages the kill switch (30 minutes by default) and returns an
 *   error result.
 * - On 4xx/5xx: returns `{ ok: false, error: "HTTP NNN: <body>" }`.
 * - On success: returns `{ ok: true, data: <parsed JSON> }`.
 *
 * @param path     API path, e.g. "/channels/123/messages" (leading slash required)
 * @param options  Standard RequestInit options (method, body, headers, …)
 */
export async function discordFetch<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<DiscordResult<T>> {
  const token = getToken();
  const method = (options.method ?? "GET").toUpperCase();
  const startMs = Date.now();

  const headers = new Headers(options.headers as HeadersInit | undefined);
  headers.set("Authorization", `Bot ${token}`);
  if (!headers.has("Content-Type") && options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${DISCORD_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (err) {
    const ms = Date.now() - startMs;
    log.error("api_call", { method, endpoint: path, status: 0, ms, service: "discord" }, err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      error: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const ms = Date.now() - startMs;

  if (response.status === 429) {
    // Rate-limited — honor Discord's Retry-After (usually 1-5s) + 5s buffer
    const retryAfter = parseFloat(response.headers.get("Retry-After") ?? "5");
    const cooldownSec = Math.min(Math.ceil(retryAfter) + 5, 60); // cap at 60s
    const expiryMs = Date.now() + cooldownSec * 1000;
    log.warn("api_call", { method, endpoint: path, status: 429, ms, service: "discord", retry: retryAfter });
    engageKillSwitch(expiryMs);

    const body = await response.text().catch(() => "");
    return {
      ok: false,
      error: `HTTP 429: rate limited — kill switch engaged for ${cooldownSec}s. ${body}`.trim(),
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.error("api_call", { method, endpoint: path, status: response.status, ms, service: "discord" });
    return {
      ok: false,
      error: `HTTP ${response.status}: ${body}`.trim(),
    };
  }

  // Parse JSON response
  try {
    const data = (await response.json()) as T;
    log.info("api_call", { method, endpoint: path, status: response.status, ms, service: "discord" });
    return { ok: true, data };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
