/**
 * Unit tests for list.ts — handleList
 *
 * Uses globalThis.fetch mocking for network calls.
 * Uses real kill files for the kill switch test.
 *
 * Tests cover:
 *  - list — default type is text → only type=0 channels returned when no type param given
 *  - list — filters by voice     → only type=2 channels returned
 *  - list — sorted by position   → channels in ascending position order
 *  - list — kill active          → error returned, no API call made
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

// Sample channels — mix of text (0), voice (2), and category (4)
const SAMPLE_CHANNELS = [
  { id: "100", name: "general", type: 0, position: 2 },
  { id: "101", name: "announcements", type: 0, position: 0 },
  { id: "200", name: "voice-lobby", type: 2, position: 1 },
  { id: "201", name: "voice-gaming", type: 2, position: 3 },
  { id: "300", name: "category-one", type: 4, position: 0 },
];

describe("list", () => {
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

  test("list — default type is text", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(SAMPLE_CHANNELS), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleList } = await import("../list.ts");

    // No type param — should default to "text" (type=0)
    const result = await handleList({ guild_id: "999" });

    const lines = result.split("\n");
    // Only type=0 channels: announcements (pos 0) and general (pos 2)
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("#announcements (101)");
    expect(lines[1]).toBe("#general (100)");
  });

  test("list — filters by voice", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(SAMPLE_CHANNELS), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleList } = await import("../list.ts");

    const result = await handleList({ guild_id: "999", type: "voice" });

    const lines = result.split("\n");
    // Only type=2 channels: voice-lobby (pos 1) and voice-gaming (pos 3)
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("#voice-lobby (200)");
    expect(lines[1]).toBe("#voice-gaming (201)");
  });

  test("list — sorted by position", async () => {
    // Channels deliberately out of position order in the API response
    const unordered = [
      { id: "500", name: "third", type: 0, position: 2 },
      { id: "501", name: "first", type: 0, position: 0 },
      { id: "502", name: "second", type: 0, position: 1 },
    ];

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(unordered), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleList } = await import("../list.ts");

    const result = await handleList({ guild_id: "999" });

    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("#first (501)");
    expect(lines[1]).toBe("#second (502)");
    expect(lines[2]).toBe("#third (500)");
  });

  test("list — kill active", async () => {
    // Engage kill switch with a future expiry
    const futureMs = Date.now() + 60_000;
    writeFileSync(KILL_FILE, String(futureMs), "utf-8");

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    const { handleList } = await import("../list.ts");

    const result = await handleList({ guild_id: "999" });

    // Should return an error string, not call the API
    expect(result).toContain("Kill switch is active");
    expect(fetchCalled).toBe(false);
  });
});
