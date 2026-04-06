/**
 * Unit tests for resolve.ts — handleResolve
 *
 * Uses globalThis.fetch mocking for network calls.
 * Uses real kill files for the kill switch test.
 *
 * Tests:
 *  - resolve — match found       → returns correct channel ID
 *  - resolve — strips hash prefix → #agent-ops matches agent-ops
 *  - resolve — case insensitive  → Agent-Ops matches agent-ops
 *  - resolve — not found         → descriptive error string
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
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

// Sample guild channels returned by Discord API
const SAMPLE_CHANNELS = [
  { id: "111", name: "general", type: 0 },
  { id: "222", name: "agent-ops", type: 0 },
  { id: "333", name: "announcements", type: 0 },
];

describe("resolve", () => {
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

  // ---------------------------------------------------------------------------
  // Test 1: match found — returns correct channel ID
  // ---------------------------------------------------------------------------
  test("resolve — match found", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(SAMPLE_CHANNELS), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleResolve } = await import("../resolve.ts");

    const result = await handleResolve({ name: "agent-ops", guild_id: "guild-1" });

    expect(result).toBe("222");
  });

  // ---------------------------------------------------------------------------
  // Test 2: strips leading '#' — #agent-ops matches agent-ops
  // ---------------------------------------------------------------------------
  test("resolve — strips hash prefix", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(SAMPLE_CHANNELS), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleResolve } = await import("../resolve.ts");

    const result = await handleResolve({ name: "#agent-ops", guild_id: "guild-1" });

    expect(result).toBe("222");
  });

  // ---------------------------------------------------------------------------
  // Test 3: case insensitive — Agent-Ops matches agent-ops
  // ---------------------------------------------------------------------------
  test("resolve — case insensitive", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(SAMPLE_CHANNELS), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleResolve } = await import("../resolve.ts");

    const result = await handleResolve({ name: "Agent-Ops", guild_id: "guild-1" });

    expect(result).toBe("222");
  });

  // ---------------------------------------------------------------------------
  // Test 4: not found — descriptive error string
  // ---------------------------------------------------------------------------
  test("resolve — not found", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(SAMPLE_CHANNELS), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleResolve } = await import("../resolve.ts");

    const result = await handleResolve({ name: "nonexistent-channel", guild_id: "guild-1" });

    expect(result).toBe("Channel '#nonexistent-channel' not found in guild");
  });
});
