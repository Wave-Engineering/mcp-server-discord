/**
 * Unit tests for api.ts
 *
 * Uses mock.module() from bun:test to mock global fetch — no real network.
 * Also sets up DISCORD_BOT_TOKEN env var so getToken() succeeds.
 *
 * Tests cover:
 *  - 429 response → kill switch engaged
 *  - 4xx response → { ok: false, error: "HTTP NNN: <body>" }
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KILL_FILE } from "../kill.ts";

const claudeDir = join(homedir(), ".claude");

function removeKillFile(): void {
  try {
    if (existsSync(KILL_FILE)) {
      require("node:fs").unlinkSync(KILL_FILE);
    }
  } catch {
    // ignore
  }
}

describe("api", () => {
  let savedToken: string | undefined;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    mkdirSync(claudeDir, { recursive: true });
    removeKillFile();
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    removeKillFile();
    if (savedToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = savedToken;
    }
    globalThis.fetch = originalFetch;
  });

  test("429 engages kill switch", async () => {
    globalThis.fetch = mock(async () =>
      new Response("rate limited", { status: 429 })
    ) as unknown as typeof fetch;

    // Import after mock so it picks up the mocked fetch
    const { discordFetch } = await import("../api.ts");

    const result = await discordFetch("/channels/123/messages");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("429");
    }
    // Kill file should have been written
    expect(existsSync(KILL_FILE)).toBe(true);
  });

  test("4xx returns error string", async () => {
    globalThis.fetch = mock(async () =>
      new Response("Unknown Channel", { status: 404 })
    ) as unknown as typeof fetch;

    const { discordFetch } = await import("../api.ts");

    const result = await discordFetch("/channels/bad-id");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("HTTP 404");
      expect(result.error).toContain("Unknown Channel");
    }
  });
});
