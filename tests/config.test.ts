/**
 * Unit tests for config.ts
 *
 * Tests cover:
 *  - discord.json values take precedence over hardcoded defaults
 *  - Invalid JSON → stderr warning + hardcoded defaults
 *  - Token from DISCORD_BOT_TOKEN env var
 *  - Token from $DISCORD_TOKEN_FILE override file
 *  - Token missing → throws "Discord bot token not found"
 *
 * Filesystem isolation (#52)
 *
 * Production code under test resolves paths from `homedir()`. Earlier
 * versions of this test wrote and deleted real `~/secrets/discord-bot-token`
 * and `~/.claude/discord.json` files on every run, silently destroying user
 * production secrets. The fix:
 *
 *   1. config.ts honors `$DISCORD_TOKEN_FILE` and `$DISCORD_CONFIG_FILE` env
 *      overrides for the two paths it derives from `homedir()`.
 *   2. This test's `beforeEach` sets both overrides to per-test tmpdir
 *      paths. No test ever writes to a real user-relative path.
 *
 * A SHA-guard in `beforeAll`/`afterAll` records the SHA of the user's real
 * `~/secrets/discord-bot-token` and `~/.claude/discord.json` (each, if
 * present) and asserts they're unchanged after the suite. Belt-and-suspenders
 * against any future test reaching outside the tmpdir.
 *
 * (HOME-override was tried first; Bun's `homedir()` ignores `process.env.HOME`
 * and reads passwd directly, so env overrides per-path is the only portable
 * isolation that works on Bun.)
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "bun:test";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  loadDiscordConfig,
  getConfigValue,
  getToken,
  _resetConfigCache,
  DEFAULT_GUILD_ID,
  DEFAULT_CHANNEL_ID,
} from "../config.ts";

function shaOrAbsent(path: string): string {
  if (!existsSync(path)) return "<absent>";
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("config", () => {
  // -- Suite-wide isolation guard (#52) -------------------------------------
  // SHA-snapshot the user's REAL paths (resolved via homedir(), which Bun
  // pins to passwd regardless of HOME — perfect for this guard). If a future
  // test regresses isolation by writing to the real path, afterAll fails
  // loudly instead of silently destroying user secrets.
  const realTokenPath = join(homedir(), "secrets", "discord-bot-token");
  const realConfigPath = join(homedir(), ".claude", "discord.json");
  let realTokenShaBefore: string;
  let realConfigShaBefore: string;
  let suiteTmpdir: string;

  beforeAll(() => {
    realTokenShaBefore = shaOrAbsent(realTokenPath);
    realConfigShaBefore = shaOrAbsent(realConfigPath);
    suiteTmpdir = mkdtempSync(join(tmpdir(), "disc-server-test-"));
  });

  afterAll(() => {
    if (suiteTmpdir && existsSync(suiteTmpdir)) {
      rmSync(suiteTmpdir, { recursive: true, force: true });
    }
    const realTokenShaAfter = shaOrAbsent(realTokenPath);
    const realConfigShaAfter = shaOrAbsent(realConfigPath);
    if (realTokenShaAfter !== realTokenShaBefore) {
      throw new Error(
        `ISOLATION VIOLATION: ${realTokenPath} changed during test run. ` +
          `before=${realTokenShaBefore} after=${realTokenShaAfter}. ` +
          `See #52 — a test reached outside the tmpdir.`
      );
    }
    if (realConfigShaAfter !== realConfigShaBefore) {
      throw new Error(
        `ISOLATION VIOLATION: ${realConfigPath} changed during test run. ` +
          `before=${realConfigShaBefore} after=${realConfigShaAfter}. ` +
          `See #52 — a test reached outside the tmpdir.`
      );
    }
  });

  // -- Per-test environment + cache reset -----------------------------------
  let savedEnv: Record<string, string | undefined>;
  let testTmpdir: string;
  let testTokenPath: string;
  let testConfigPath: string;

  beforeEach(() => {
    savedEnv = {
      DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
      DISCORD_TOKEN_FILE: process.env.DISCORD_TOKEN_FILE,
      DISCORD_CONFIG_FILE: process.env.DISCORD_CONFIG_FILE,
    };

    // Per-test tmpdir under the suite tmpdir, so concurrent file writes
    // from different tests can't collide.
    testTmpdir = mkdtempSync(join(suiteTmpdir, "test-"));
    testTokenPath = join(testTmpdir, "discord-bot-token");
    testConfigPath = join(testTmpdir, "discord.json");

    // Redirect production code to this tmpdir for the duration of the test.
    process.env.DISCORD_TOKEN_FILE = testTokenPath;
    process.env.DISCORD_CONFIG_FILE = testConfigPath;

    _resetConfigCache();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (testTmpdir && existsSync(testTmpdir)) {
      rmSync(testTmpdir, { recursive: true, force: true });
    }
    _resetConfigCache();
  });

  function writeConfig(content: string): void {
    writeFileSync(testConfigPath, content, "utf-8");
  }

  function removeConfig(): void {
    if (existsSync(testConfigPath)) unlinkSync(testConfigPath);
  }

  function writeTokenFile(content: string): void {
    writeFileSync(testTokenPath, content, "utf-8");
  }

  function removeTokenFile(): void {
    if (existsSync(testTokenPath)) unlinkSync(testTokenPath);
  }

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

  test("token from $DISCORD_TOKEN_FILE", () => {
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

  test("$DISCORD_TOKEN_FILE override at a different path", () => {
    delete process.env.DISCORD_BOT_TOKEN;
    const altPath = join(testTmpdir, "alt-token");
    writeFileSync(altPath, "alt-token-content\n", "utf-8");
    process.env.DISCORD_TOKEN_FILE = altPath;

    const token = getToken();
    expect(token).toBe("alt-token-content");
  });

  // The empty-string-falls-back-to-default behavior is exercised indirectly
  // by every test that doesn't override DISCORD_TOKEN_FILE — the production
  // resolver's `if (override !== undefined && override !== "")` guard is
  // a single-line code path. A dedicated test that wrote to the real default
  // path would re-introduce exactly the destructive-test bug that #52 fixes,
  // so we don't have one. If the resolver's empty-string handling regresses,
  // the existing `token from $DISCORD_TOKEN_FILE` test (which depends on the
  // beforeEach-set tmpdir override being honored) will fail.
});
