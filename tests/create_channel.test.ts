/**
 * Unit tests for create_channel.ts — handleCreateChannel
 *
 * Uses globalThis.fetch mocking for network calls.
 * Uses real kill files for the kill switch test.
 *
 * Tests cover:
 *  - create_channel — sanitizes name (spaces→hyphens, strip '#', lowercase)
 *  - create_channel — with topic
 *  - create_channel — minimal payload (no topic/category → only name and type)
 *  - create_channel — kill active → error returned, no API call made
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

describe("create_channel", () => {
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

  test("create_channel — sanitizes name", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ id: "555", name: "hello-world" }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const { handleCreateChannel } = await import("../create_channel.ts");

    const result = await handleCreateChannel({
      guild_id: "999",
      name: "#Hello World",
    });

    // Name should be sanitized: strip '#', spaces→hyphens, lowercase
    expect(capturedBody?.name).toBe("hello-world");
    expect(result).toBe("Created channel #hello-world (555)");
  });

  test("create_channel — with topic", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ id: "556", name: "announcements" }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const { handleCreateChannel } = await import("../create_channel.ts");

    const result = await handleCreateChannel({
      guild_id: "999",
      name: "announcements",
      topic: "Official announcements only",
    });

    expect(capturedBody?.name).toBe("announcements");
    expect(capturedBody?.type).toBe(0);
    expect(capturedBody?.topic).toBe("Official announcements only");
    expect(result).toBe("Created channel #announcements (556)");
  });

  test("create_channel — minimal payload", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({ id: "557", name: "general" }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;

    const { handleCreateChannel } = await import("../create_channel.ts");

    const result = await handleCreateChannel({
      guild_id: "999",
      name: "general",
    });

    // Only name and type should be in the payload
    expect(capturedBody?.name).toBe("general");
    expect(capturedBody?.type).toBe(0);
    expect(capturedBody?.topic).toBeUndefined();
    expect(capturedBody?.parent_id).toBeUndefined();
    expect(result).toBe("Created channel #general (557)");
  });

  test("create_channel — kill active", async () => {
    // Engage kill switch with a future expiry
    const futureMs = Date.now() + 60_000;
    writeFileSync(KILL_FILE, String(futureMs), "utf-8");

    let fetchCalled = false;
    globalThis.fetch = mock(async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ id: "0", name: "x" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleCreateChannel } = await import("../create_channel.ts");

    const result = await handleCreateChannel({
      guild_id: "999",
      name: "test-channel",
    });

    // Should return an error string, not call the API
    expect(result).toContain("Kill switch is active");
    expect(fetchCalled).toBe(false);
  });
});
