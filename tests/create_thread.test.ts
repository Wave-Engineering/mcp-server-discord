/**
 * Unit tests for create_thread.ts — handleCreateThread
 *
 * Uses globalThis.fetch mocking for network calls.
 * Uses real kill files for the kill switch test.
 *
 * Tests cover:
 *  - create_thread — default archive: omitted auto_archive → 1440 in payload
 *  - create_thread — invalid archive: invalid duration → error before fetch
 *  - create_thread — valid durations: each allowed value accepted
 *  - create_thread — kill active → error returned, no API call made
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

describe("create_thread", () => {
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

  test("create_thread — default archive", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ id: "111", name: "my-thread" }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const { handleCreateThread } = await import("../create_thread.ts");

    const result = await handleCreateThread({
      channel_id: "999",
      name: "my-thread",
    });

    // auto_archive should default to 1440
    expect(capturedBody?.auto_archive_duration).toBe(1440);
    expect(capturedBody?.type).toBe(11);
    expect(capturedBody?.name).toBe("my-thread");
    expect(result).toBe("Created thread 'my-thread' (111)");
  });

  test("create_thread — invalid archive", async () => {
    let fetchCalled = false;

    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ id: "0", name: "x" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleCreateThread } = await import("../create_thread.ts");

    const result = await handleCreateThread({
      channel_id: "999",
      name: "bad-thread",
      auto_archive: 9999,
    });

    // Should return error without calling the API
    expect(result).toContain("Error");
    expect(result).toContain("auto_archive");
    expect(fetchCalled).toBe(false);
  });

  test("create_thread — valid durations", async () => {
    const validDurations = [60, 1440, 4320, 10080];

    for (const duration of validDurations) {
      let capturedBody: Record<string, unknown> | undefined;

      globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ id: "222", name: "duration-thread" }),
          { status: 200 }
        );
      }) as unknown as typeof fetch;

      const { handleCreateThread } = await import("../create_thread.ts");

      const result = await handleCreateThread({
        channel_id: "999",
        name: "duration-thread",
        auto_archive: duration,
      });

      expect(capturedBody?.auto_archive_duration).toBe(duration);
      expect(result).toBe("Created thread 'duration-thread' (222)");
    }
  });

  test("create_thread — kill active", async () => {
    // Engage kill switch with a future expiry
    const futureMs = Date.now() + 60_000;
    writeFileSync(KILL_FILE, String(futureMs), "utf-8");

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ id: "0", name: "x" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleCreateThread } = await import("../create_thread.ts");

    const result = await handleCreateThread({
      channel_id: "999",
      name: "test-thread",
    });

    // Should return an error string, not call the API
    expect(result).toContain("Kill switch is active");
    expect(fetchCalled).toBe(false);
  });
});
