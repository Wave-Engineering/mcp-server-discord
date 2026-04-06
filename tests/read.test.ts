/**
 * Unit tests for read.ts — handleRead
 *
 * Uses globalThis.fetch mocking for network calls.
 * Uses real kill files for the kill switch test.
 *
 * Tests cover:
 *  - read — formats digest      → correct [ts] <user>: content format, chronological
 *  - read — default limit       → limit=20 in request URL when no limit param given
 *  - read — clamps limit        → limit=200 clamped to 100
 *  - read — kill active         → error returned, no API call made
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

// Sample Discord messages — Discord API returns newest-first
const SAMPLE_MESSAGES = [
  {
    id: "3",
    timestamp: "2024-01-01T12:02:00.000Z",
    content: "newest message",
    author: { id: "u3", username: "charlie" },
  },
  {
    id: "2",
    timestamp: "2024-01-01T12:01:00.000Z",
    content: "middle message",
    author: { id: "u2", username: "bob" },
  },
  {
    id: "1",
    timestamp: "2024-01-01T12:00:00.000Z",
    content: "oldest message",
    author: { id: "u1", username: "alice" },
  },
];

describe("read", () => {
  let savedToken: string | undefined;
  let originalFetch: typeof fetch;
  let capturedUrl: string | undefined;

  beforeEach(() => {
    mkdirSync(claudeDir, { recursive: true });
    removeKillFile();
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
    originalFetch = globalThis.fetch;
    capturedUrl = undefined;
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

  test("read — formats digest", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify(SAMPLE_MESSAGES), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleRead } = await import("../read.ts");

    const result = await handleRead({ channel_id: "123456" });

    // Output should be chronological (oldest first)
    const lines = result.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("[2024-01-01T12:00:00.000Z] <alice>: oldest message");
    expect(lines[1]).toBe("[2024-01-01T12:01:00.000Z] <bob>: middle message");
    expect(lines[2]).toBe("[2024-01-01T12:02:00.000Z] <charlie>: newest message");
  });

  test("read — default limit", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify([SAMPLE_MESSAGES[0]]), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleRead } = await import("../read.ts");

    await handleRead({ channel_id: "789" });

    // URL should contain limit=20 (the default)
    expect(capturedUrl).toContain("limit=20");
  });

  test("read — clamps limit", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify([SAMPLE_MESSAGES[0]]), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleRead } = await import("../read.ts");

    await handleRead({ channel_id: "789", limit: 200 });

    // limit=200 should be clamped to 100
    expect(capturedUrl).toContain("limit=100");
    expect(capturedUrl).not.toContain("limit=200");
  });

  test("read — kill active", async () => {
    // Engage kill switch with a future expiry
    const futureMs = Date.now() + 60_000;
    writeFileSync(KILL_FILE, String(futureMs), "utf-8");

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    const { handleRead } = await import("../read.ts");

    const result = await handleRead({ channel_id: "123" });

    // Should return an error string, not call the API
    expect(result).toContain("Kill switch is active");
    expect(fetchCalled).toBe(false);
  });
});
