/**
 * api.ts — Discord REST API client for the disc MCP server.
 *
 * Provides:
 *  - DISCORD_BASE      — Discord API v10 base URL (resolved lazily)
 *  - resolveApiBase()  — health-check scream-hole, fall back to direct Discord API
 *  - isScreamHole()    — whether the current session routes through scream-hole
 *  - discordFetch()    — authenticated fetch wrapper with 429/4xx/5xx handling
 */

import { getConfigValue } from "./config.ts";
import { getToken } from "./config.ts";
import { engageKillSwitch } from "./kill.ts";
import { log } from "./logger.ts";

const DIRECT_DISCORD_BASE = "https://discord.com/api/v10";
const API_SUFFIX = "/api/v10";
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

// Resolved at runtime by resolveApiBase()
let DISCORD_BASE = DIRECT_DISCORD_BASE;
let _resolved = false;
let _usingScreamHole = false;

/**
 * Reset routing state (used by tests only).
 * @internal
 */
export function _resetRoutingState(): void {
  DISCORD_BASE = DIRECT_DISCORD_BASE;
  _resolved = false;
  _usingScreamHole = false;
}

/**
 * Whether the current session is routing through scream-hole.
 * Only meaningful after resolveApiBase() has been called.
 */
export function isScreamHole(): boolean {
  return _usingScreamHole;
}

/**
 * Return the current DISCORD_BASE value (for callers that bypass discordFetch).
 * Always call resolveApiBase() first or rely on discordFetch() which calls it.
 */
export function getDiscordBase(): string {
  return DISCORD_BASE;
}

/**
 * Resolve the Discord API base URL.
 *
 * If `scream_hole_url` is configured (via ~/.claude/discord.json or
 * SCREAM_HOLE_URL env var), health-check the proxy and use it when healthy.
 * Falls back to direct Discord API on failure or when unconfigured.
 *
 * Safe to call multiple times — resolves only once per process.
 */
export async function resolveApiBase(): Promise<string> {
  if (_resolved) return DISCORD_BASE;
  _resolved = true;

  const screamHoleUrl = getConfigValue("scream_hole_url", "SCREAM_HOLE_URL", "");
  if (!screamHoleUrl) {
    log.info("routing", { mode: "direct", reason: "scream_hole_url not configured" });
    return DISCORD_BASE;
  }

  // Strip trailing slashes for consistent joining
  const baseUrl = screamHoleUrl.replace(/\/+$/, "");

  // Derive the health endpoint from the raw base (not the /api/v10 suffix)
  // The config value may already include /api/v10 — strip it to find the root
  const rootUrl = baseUrl.replace(/\/api\/v10\/?$/, "");
  const healthUrl = `${rootUrl}/health`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      // Build the API base: if the configured URL already ends with /api/v10, use it as-is
      DISCORD_BASE = baseUrl.endsWith(API_SUFFIX) ? baseUrl : `${baseUrl}${API_SUFFIX}`;
      _usingScreamHole = true;
      log.info("routing", { mode: "scream-hole", url: DISCORD_BASE });
      return DISCORD_BASE;
    }

    log.warn("routing", { mode: "direct", reason: "health check failed", status: res.status, url: healthUrl });
  } catch (err) {
    log.warn(
      "routing",
      { mode: "direct", reason: "health check error", url: healthUrl },
      err instanceof Error ? err.message : String(err)
    );
  }

  // Fallback to direct Discord API
  log.info("routing", { mode: "direct", reason: "scream-hole unavailable" });
  return DISCORD_BASE;
}

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
  // Ensure base URL has been resolved (no-op after first call)
  await resolveApiBase();

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
