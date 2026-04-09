/**
 * Unit tests for send.ts (handleSend)
 *
 * Uses real kill files for kill switch tests.
 * Mocks globalThis.fetch for network call tests.
 *
 * Tests:
 *  - single message    — ≤2000 chars → 1 API call
 *  - split 2-part      — 2001 chars → 2 calls, labeled (1/2), (2/2)
 *  - kill active       — kill switch active → 0 API calls, error returned
 *  - embed in last     — embed param → embeds object in final call
 *  - attach path       — attach_path → multipart FormData used
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { writeFileSync, existsSync, mkdirSync, writeSync, openSync, closeSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
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

describe("disc_send — handleSend", () => {
  let originalFetch: typeof globalThis.fetch;
  let savedToken: string | undefined;

  beforeEach(() => {
    mkdirSync(claudeDir, { recursive: true });
    removeKillFile();
    originalFetch = globalThis.fetch;
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
  });

  afterEach(() => {
    removeKillFile();
    globalThis.fetch = originalFetch;
    if (savedToken === undefined) {
      delete process.env.DISCORD_BOT_TOKEN;
    } else {
      process.env.DISCORD_BOT_TOKEN = savedToken;
    }
  });

  // ---------------------------------------------------------------------------
  // Test 1: single message (≤2000 chars)
  // ---------------------------------------------------------------------------
  test("send — single message", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleSend } = await import("../send.ts");

    const result = await handleSend({
      channel_id: "123",
      message: "Hello, world!",
    });

    expect(calls.length).toBe(1);
    expect(result).toContain("123");
    expect(result).toContain("1 chunk");

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.content).toBe("Hello, world!");
  });

  // ---------------------------------------------------------------------------
  // Test 2: split 2-part (2001 chars → 2 calls, labeled (1/2) and (2/2))
  // ---------------------------------------------------------------------------
  test("send — split 2-part", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleSend } = await import("../send.ts");

    // Build a message that is exactly 2001 chars — one char over the limit.
    // Use word-friendly content so the splitter has a clean word boundary.
    // Each word is 9 chars + space = 10 chars. 200 words = 2000 chars (with trailing space removed).
    // We need content > 2000 chars total. We'll use a 2001-char string.
    const longWord = "a".repeat(999);
    const message = longWord + " " + longWord + " extra"; // 999 + 1 + 999 + 1 + 5 = 2005 chars

    const result = await handleSend({
      channel_id: "456",
      message,
    });

    expect(calls.length).toBe(2);
    expect(result).toContain("2 chunks");

    const body1 = JSON.parse(calls[0].init.body as string);
    const body2 = JSON.parse(calls[1].init.body as string);
    expect(body1.content).toMatch(/^\(1\/2\)/);
    expect(body2.content).toMatch(/^\(2\/2\)/);
  });

  // ---------------------------------------------------------------------------
  // Test 3: kill switch active → 0 API calls, error returned
  // ---------------------------------------------------------------------------
  test("send — kill active", async () => {
    // Write a manual kill file (empty = active indefinitely)
    writeFileSync(KILL_FILE, "", "utf-8");

    const fetchSpy = mock(async () => {
      throw new Error("Should not be called");
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const { handleSend } = await import("../send.ts");

    const result = await handleSend({
      channel_id: "789",
      message: "Should not send",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toContain("Kill switch is active");
  });

  // ---------------------------------------------------------------------------
  // Test 4: embed in last chunk
  // ---------------------------------------------------------------------------
  test("send — embed in last chunk", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleSend } = await import("../send.ts");

    const result = await handleSend({
      channel_id: "321",
      message: "Check this out",
      embed: "My Title:This is the body of the embed",
    });

    expect(calls.length).toBe(1);
    expect(result).toContain("321");

    const body = JSON.parse(calls[0].init.body as string);
    expect(body.embeds).toBeDefined();
    expect(body.embeds.length).toBe(1);
    expect(body.embeds[0].title).toBe("My Title");
    expect(body.embeds[0].description).toBe("This is the body of the embed");
  });

  // ---------------------------------------------------------------------------
  // Test 5: attach path → multipart FormData used
  // ---------------------------------------------------------------------------
  test("send — attach path", async () => {
    const calls: { url: string; init: RequestInit; bodyType: string }[] = [];

    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init, bodyType: init.body?.constructor?.name ?? "unknown" });
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleSend } = await import("../send.ts");

    // Create a temp file to attach
    const tmpFile = join(tmpdir(), "test-attach.txt");
    writeFileSync(tmpFile, "hello attachment", "utf-8");

    const result = await handleSend({
      channel_id: "654",
      message: "Here is a file",
      attach_path: tmpFile,
    });

    expect(calls.length).toBe(1);
    expect(result).toContain("attachment");

    // Verify FormData was used, not plain JSON string
    const { body } = calls[0].init;
    expect(body).toBeInstanceOf(FormData);
  });

  // ---------------------------------------------------------------------------
  // Test 6: content-dense markdown splitting (regression test for #37)
  // ---------------------------------------------------------------------------
  test("send — content-dense markdown stays under 2000 chars per labeled chunk", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleSend } = await import("../send.ts");

    // Build a ~4500-char markdown table (content-dense: few word boundaries)
    // This is the scenario reported in #37 by @percolator and cc-workflow orchestrator
    const tableHeader = "| Column A | Column B | Column C | Column D | Column E |\n";
    const tableSep = "|----------|----------|----------|----------|----------|\n";
    const tableRow = "| Value 1234 | Value 5678 | Value 9012 | Value 3456 | Value 7890 |\n";

    // Each row is ~69 chars. To get ~4500 chars, we need ~65 rows.
    const tableBody = tableRow.repeat(65);
    const message = tableHeader + tableSep + tableBody; // ~4500 chars

    expect(message.length).toBeGreaterThan(4000); // Sanity check

    const result = await handleSend({
      channel_id: "999",
      message,
    });

    expect(result).toContain("999");
    expect(calls.length).toBeGreaterThan(1); // Should split into multiple chunks

    // CRITICAL ASSERTION: Every chunk sent to Discord API must be ≤2000 chars
    for (let i = 0; i < calls.length; i++) {
      const body = JSON.parse(calls[i].init.body as string);
      const content = body.content as string;
      expect(content.length).toBeLessThanOrEqual(2000);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 7: 100+ chunks edge case (regression test for label overhead)
  // ---------------------------------------------------------------------------
  test("send — 100+ chunks with label overhead stays under limit", async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "msg-1" }), { status: 200 });
    }) as unknown as typeof fetch;

    const { handleSend } = await import("../send.ts");

    // Build a ~200KB message that will produce 100+ chunks
    // At 1988 chars per chunk (2000 - 12 label overhead), we need ~100 chunks for 198,800 chars
    const largeMessage = "x".repeat(200000);

    expect(largeMessage.length).toBeGreaterThan(198000); // Sanity check

    const result = await handleSend({
      channel_id: "888",
      message: largeMessage,
    });

    expect(result).toContain("888");
    expect(calls.length).toBeGreaterThanOrEqual(100); // Should produce 100+ chunks

    // CRITICAL ASSERTION: Every chunk must be ≤2000 chars, even at 100+ chunk boundary
    for (let i = 0; i < calls.length; i++) {
      const body = JSON.parse(calls[i].init.body as string);
      const content = body.content as string;
      expect(content.length).toBeLessThanOrEqual(2000);
    }
  });
});
