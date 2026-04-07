/**
 * Unit tests for config.ts
 *
 * Tests cover:
 *  - discord.json values take precedence over hardcoded defaults
 *  - Invalid JSON → stderr warning + hardcoded defaults
 *  - Token from DISCORD_BOT_TOKEN env var
 *  - Token from ~/secrets/discord-bot-token file
 *  - Token missing → throws "Discord bot token not found"
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  loadDiscordConfig,
  getConfigValue,
  getToken,
  _resetConfigCache,
  DEFAULT_GUILD_ID,
  DEFAULT_CHANNEL_ID,
} from "../config.ts";

const CONFIG_PATH = join(homedir(), ".claude", "discord.json");
const TOKEN_FILE_PATH = join(homedir(), "secrets", "discord-bot-token");

function writeConfig(content: string): void {
  const dir = join(homedir(), ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, content, "utf-8");
}

function removeConfig(): void {
  if (existsSync(CONFIG_PATH)) {
    unlinkSync(CONFIG_PATH);
  }
}

function writeTokenFile(content: string): void {
  const dir = join(homedir(), "secrets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(TOKEN_FILE_PATH, content, "utf-8");
}

function removeTokenFile(): void {
  if (existsSync(TOKEN_FILE_PATH)) {
    unlinkSync(TOKEN_FILE_PATH);
  }
}

describe("config", () => {
  // Save and restore environment around each test
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {
      DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    };
    // Reset cache so each test starts fresh
    _resetConfigCache();
  });

  afterEach(() => {
    // Restore environment
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    // Clean up any files written during the test
    removeConfig();
    removeTokenFile();
    _resetConfigCache();
  });

  // ---------------------------------------------------------------------------
  // loadDiscordConfig / getConfigValue
  // ---------------------------------------------------------------------------

  test("json overrides defaults", () => {
    const overrideGuild = "override-guild-111";
    writeConfig(JSON.stringify({ guild_id: overrideGuild }));

    const result = getConfigValue("guild_id", "UNUSED_ENV", DEFAULT_GUILD_ID);
    expect(result).toBe(overrideGuild);
  });

  test("invalid json falls back to hardcoded default and warns stderr", () => {
    writeConfig("{ not valid json }}}");

    const stderrMessages: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: string | Uint8Array, ...args: unknown[]) => {
      if (typeof chunk === "string") stderrMessages.push(chunk);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalWrite(chunk as any, ...(args as any[]));
    };

    try {
      const result = getConfigValue("guild_id", "UNUSED_ENV", DEFAULT_GUILD_ID);
      expect(result).toBe(DEFAULT_GUILD_ID);
      expect(stderrMessages.some((m) => m.includes("invalid JSON"))).toBe(true);
    } finally {
      process.stderr.write = originalWrite;
    }
  });

  test("env var takes precedence over hardcoded default when no json", () => {
    // No config file
    removeConfig();
    process.env["TEST_CHANNEL_ENV"] = "env-channel-999";

    const result = getConfigValue(
      "channel_id",
      "TEST_CHANNEL_ENV",
      DEFAULT_CHANNEL_ID
    );
    expect(result).toBe("env-channel-999");
    delete process.env["TEST_CHANNEL_ENV"];
  });

  // ---------------------------------------------------------------------------
  // getToken
  // ---------------------------------------------------------------------------

  test("token from env", () => {
    delete process.env.DISCORD_BOT_TOKEN;
    removeTokenFile();
    process.env.DISCORD_BOT_TOKEN = "env-bot-token-abc";

    const token = getToken();
    expect(token).toBe("env-bot-token-abc");
  });

  test("token from file", () => {
    delete process.env.DISCORD_BOT_TOKEN;
    writeTokenFile("file-bot-token-xyz\n");

    const token = getToken();
    expect(token).toBe("file-bot-token-xyz");
  });

  test("token missing throws", () => {
    delete process.env.DISCORD_BOT_TOKEN;
    removeTokenFile();

    expect(() => getToken()).toThrow("Discord bot token not found");
  });

  test("token from $DISCORD_TOKEN_FILE override", () => {
    delete process.env.DISCORD_BOT_TOKEN;
    // Use a temp path that does NOT collide with the default location.
    // This protects systems where ~/secrets/discord-bot-token is a real
    // production token file or symlink that must not be touched.
    const overridePath = join(homedir(), ".cache", "test-disc-token-override");
    mkdirSync(join(homedir(), ".cache"), { recursive: true });
    writeFileSync(overridePath, "override-token-from-env-var\n", "utf-8");
    process.env.DISCORD_TOKEN_FILE = overridePath;

    try {
      const token = getToken();
      expect(token).toBe("override-token-from-env-var");
    } finally {
      delete process.env.DISCORD_TOKEN_FILE;
      if (existsSync(overridePath)) unlinkSync(overridePath);
    }
  });

  test("$DISCORD_TOKEN_FILE override is empty string falls back to default path", () => {
    delete process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_TOKEN_FILE = "";
    writeTokenFile("default-path-token\n");

    const token = getToken();
    expect(token).toBe("default-path-token");
    delete process.env.DISCORD_TOKEN_FILE;
  });
});
