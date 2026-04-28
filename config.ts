/**
 * config.ts — Shared configuration infrastructure for the disc MCP server.
 *
 * Provides:
 *  - loadDiscordConfig()     — reads ~/.claude/discord.json, caches result
 *  - getConfigValue()        — 3-step fallback: json → env → hardcoded default
 *  - getToken()              — DISCORD_BOT_TOKEN env → $DISCORD_TOKEN_FILE (default ~/secrets/discord-bot-token) → throws
 *  - Hardcoded defaults: DEFAULT_GUILD_ID, DEFAULT_CHANNEL_ID, DEFAULT_ROLL_CALL_ID
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Hardcoded defaults
// ---------------------------------------------------------------------------

export const DEFAULT_GUILD_ID = "1234567890";
export const DEFAULT_CHANNEL_ID = "1234567890";
export const DEFAULT_ROLL_CALL_ID = "1234567890";

// ---------------------------------------------------------------------------
// Config file loading
// ---------------------------------------------------------------------------

/**
 * Resolve the path to the discord.json config file at call time.
 *
 * Honors `$DISCORD_CONFIG_FILE` if set; otherwise falls back to the default
 * `~/.claude/discord.json`. The env override exists so test harnesses can
 * isolate the config file to a tmpdir without touching real user state —
 * see #52 for the destructive-test incident this pattern prevents.
 */
function getConfigPath(): string {
  const override = process.env.DISCORD_CONFIG_FILE;
  if (override !== undefined && override !== "") {
    return override;
  }
  return join(homedir(), ".claude", "discord.json");
}

let cachedConfig: Record<string, unknown> | null = null;
let cacheLoaded = false;

/**
 * Load (and cache) ~/.claude/discord.json.
 * Returns an empty object if the file doesn't exist or contains invalid JSON.
 */
export function loadDiscordConfig(): Record<string, unknown> {
  if (cacheLoaded) {
    return cachedConfig ?? {};
  }

  cacheLoaded = true;

  if (!existsSync(getConfigPath())) {
    cachedConfig = {};
    return cachedConfig;
  }

  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    cachedConfig = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    process.stderr.write(
      `Warning: ~/.claude/discord.json contains invalid JSON — using hardcoded defaults\n`
    );
    cachedConfig = {};
  }

  return cachedConfig;
}

/**
 * Reset the config cache (used by tests only).
 * @internal
 */
export function _resetConfigCache(): void {
  cachedConfig = null;
  cacheLoaded = false;
}

// ---------------------------------------------------------------------------
// Config value resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a configuration value with a 3-step fallback:
 *   1. Value at `jqPath` key in ~/.claude/discord.json
 *   2. Environment variable `envVar`
 *   3. `hardcodedDefault`
 *
 * @param jqPath         Top-level key name in the JSON config object
 * @param envVar         Name of the environment variable to check
 * @param hardcodedDefault  Fallback value when neither source is present
 */
export function getConfigValue(
  jqPath: string,
  envVar: string,
  hardcodedDefault: string
): string {
  const config = loadDiscordConfig();

  if (jqPath in config && typeof config[jqPath] === "string") {
    return config[jqPath] as string;
  }

  const envValue = process.env[envVar];
  if (envValue !== undefined && envValue !== "") {
    return envValue;
  }

  return hardcodedDefault;
}

// ---------------------------------------------------------------------------
// Token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the default token file path (~/secrets/discord-bot-token) at call
 * time.
 *
 * Computed lazily for the same reason as `getConfigPath()` — test harnesses
 * override $HOME to a tmpdir, which only redirects `homedir()` when the path
 * is resolved at call time. See #52.
 */
export function getDefaultTokenFilePath(): string {
  return join(homedir(), "secrets", "discord-bot-token");
}

/**
 * @deprecated Use `getDefaultTokenFilePath()` instead. Frozen-at-import-time
 * value retained for backward compatibility with any external consumer that
 * still imports the constant by name. New code should call the function so
 * `$DISCORD_TOKEN_FILE` overrides and HOME changes are honored.
 */
export const DEFAULT_TOKEN_FILE_PATH = getDefaultTokenFilePath();

/**
 * Resolve the path to the token file.
 * Honors $DISCORD_TOKEN_FILE if set; otherwise falls back to the default
 * (~/secrets/discord-bot-token). Resolved at call time so env changes
 * after module load are still picked up.
 */
function resolveTokenFilePath(): string {
  const override = process.env.DISCORD_TOKEN_FILE;
  if (override !== undefined && override !== "") {
    return override;
  }
  return getDefaultTokenFilePath();
}

/**
 * Resolve the Discord bot token:
 *   1. DISCORD_BOT_TOKEN environment variable (token value)
 *   2. File at $DISCORD_TOKEN_FILE (default ~/secrets/discord-bot-token)
 *
 * Throws if neither source provides a non-empty value.
 */
export function getToken(): string {
  const envToken = process.env.DISCORD_BOT_TOKEN;
  if (envToken !== undefined && envToken !== "") {
    return envToken;
  }

  const tokenFilePath = resolveTokenFilePath();
  if (existsSync(tokenFilePath)) {
    const fileToken = readFileSync(tokenFilePath, "utf-8").trim();
    if (fileToken !== "") {
      return fileToken;
    }
  }

  throw new Error("Discord bot token not found");
}
