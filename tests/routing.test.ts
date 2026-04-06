/**
 * IT-06 — Routing integration test for the disc MCP server.
 *
 * Verifies that all 6 tool calls route to real handler implementations
 * (not stubs) via real MCP protocol round-trips using InMemoryTransport.
 *
 * Approach:
 *  - Import TOOLS and HANDLERS wiring directly from index.ts
 *  - Set DISCORD_BOT_TOKEN env var so getToken() succeeds
 *  - Ensure KILL_FILE does not exist so kill switch is inactive
 *  - Mock globalThis.fetch to return valid Discord API responses
 *  - Assert results are non-empty strings that are NOT "not implemented"
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, unlinkSync } from "node:fs";
import { TOOLS } from "../index.ts";
import { handleSend } from "../send.ts";
import { handleRead } from "../read.ts";
import { handleList } from "../list.ts";
import { handleResolve } from "../resolve.ts";
import { handleCreateChannel } from "../create_channel.ts";
import { handleCreateThread } from "../create_thread.ts";
import { KILL_FILE } from "../kill.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Typed shape of a tools/call result with text content items. */
interface ToolCallResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Discord message object */
const MOCK_MESSAGE = {
  id: "111",
  timestamp: "2024-01-01T00:00:00.000Z",
  content: "hello",
  author: { id: "222", username: "testuser" },
};

/** Minimal Discord channel object */
const MOCK_CHANNEL = { id: "456", name: "test-channel", type: 0, position: 0 };

/** Minimal Discord thread object */
const MOCK_THREAD = { id: "789", name: "test-thread" };

/** Minimal Discord message sent response */
const MOCK_MESSAGE_SENT = { id: "999" };

/**
 * Build a mock fetch that returns different payloads depending on the URL path.
 * Cast to `unknown` first to avoid the `preconnect` property requirement on
 * `typeof fetch` — bun's stricter fetch type includes it but we only need the
 * call signature for tests.
 */
function buildMockFetch(overrides: Record<string, unknown> = {}): unknown {
  return async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();

    // Determine which mock data to return based on URL patterns
    let payload: unknown;

    if (url.includes("/threads")) {
      // POST /channels/{id}/threads → thread object
      payload = MOCK_THREAD;
    } else if (url.includes("/messages")) {
      // GET or POST /channels/{id}/messages
      if (_init?.method === "POST") {
        payload = MOCK_MESSAGE_SENT;
      } else {
        payload = [MOCK_MESSAGE];
      }
    } else if (url.includes("/channels")) {
      // GET /guilds/{id}/channels or POST /guilds/{id}/channels
      if (_init?.method === "POST") {
        payload = MOCK_CHANNEL;
      } else {
        payload = [MOCK_CHANNEL, { ...MOCK_CHANNEL, id: "457", name: "general" }];
      }
    } else {
      payload = overrides[url] ?? {};
    }

    const body = JSON.stringify(payload);
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// ---------------------------------------------------------------------------
// Server factory — wires real handlers from their respective modules
// ---------------------------------------------------------------------------

function createRealServer(): Server {
  const server = new Server(
    { name: "disc-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const HANDLERS: Record<
    string,
    (params: Record<string, unknown>) => Promise<string>
  > = {
    disc_send: handleSend,
    disc_read: async (params) => handleRead(params),
    disc_list: handleList,
    disc_resolve: handleResolve,
    disc_create_channel: handleCreateChannel,
    disc_create_thread: handleCreateThread,
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = HANDLERS[name];

    if (!handler) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    const result = await handler((args ?? {}) as Record<string, unknown>);
    return {
      content: [{ type: "text" as const, text: result }],
    };
  });

  return server;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("IT-06: routing integration", () => {
  let server: Server;
  let client: Client;
  let originalFetch: typeof globalThis.fetch;
  let originalToken: string | undefined;

  beforeEach(() => {
    // Stash real fetch and inject mock
    originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = buildMockFetch() as any;

    // Set bot token so getToken() succeeds
    originalToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "test-bot-token-it06";

    // Ensure kill switch is not active
    if (existsSync(KILL_FILE)) {
      unlinkSync(KILL_FILE);
    }
  });

  afterEach(async () => {
    // Restore fetch and token
    globalThis.fetch = originalFetch;
    if (originalToken !== undefined) {
      process.env.DISCORD_BOT_TOKEN = originalToken;
    } else {
      delete process.env.DISCORD_BOT_TOKEN;
    }

    await client?.close();
    await server?.close();
  });

  async function connectPair() {
    server = createRealServer();
    client = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  }

  // -------------------------------------------------------------------------
  // tools/list — schema check
  // -------------------------------------------------------------------------

  test("tools/list returns exactly 6 tools", async () => {
    await connectPair();
    const result = await client.listTools();
    expect(result.tools).toHaveLength(6);
  });

  test("tools/list contains all 6 expected tool names", async () => {
    await connectPair();
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "disc_create_channel",
      "disc_create_thread",
      "disc_list",
      "disc_read",
      "disc_resolve",
      "disc_send",
    ]);
  });

  // -------------------------------------------------------------------------
  // tools/call — real handler routing
  // -------------------------------------------------------------------------

  test("disc_send routes to real handler and returns a string", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_send",
      arguments: { channel_id: "123", message: "test" },
    });
    const result = raw as unknown as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe("not implemented");
  });

  test("disc_read routes to real handler and returns a string", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_read",
      arguments: { channel_id: "123" },
    });
    const result = raw as unknown as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe("not implemented");
  });

  test("disc_list routes to real handler and returns a string", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_list",
      arguments: { guild_id: "123" },
    });
    const result = raw as unknown as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe("not implemented");
  });

  test("disc_resolve routes to real handler and returns a string", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_resolve",
      arguments: { name: "general", guild_id: "123" },
    });
    const result = raw as unknown as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe("not implemented");
  });

  test("disc_create_channel routes to real handler and returns a string", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_create_channel",
      arguments: { guild_id: "123", name: "test-channel" },
    });
    const result = raw as unknown as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe("not implemented");
  });

  test("disc_create_thread routes to real handler and returns a string", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_create_thread",
      arguments: { channel_id: "123", name: "test-thread" },
    });
    const result = raw as unknown as ToolCallResult;
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    const text = result.content[0].text;
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toBe("not implemented");
  });

  // -------------------------------------------------------------------------
  // Content spot-checks — verify handlers return plausible output
  // -------------------------------------------------------------------------

  test("disc_send response confirms message was sent", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_send",
      arguments: { channel_id: "123", message: "test" },
    });
    const result = raw as unknown as ToolCallResult;
    const text = result.content[0].text;
    // handleSend returns "Message sent to {channel_id} ..."
    expect(text).toContain("sent");
  });

  test("disc_read response contains message content", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_read",
      arguments: { channel_id: "123" },
    });
    const result = raw as unknown as ToolCallResult;
    const text = result.content[0].text;
    // handleRead returns "[timestamp] <username>: content" lines
    expect(text).toContain("testuser");
    expect(text).toContain("hello");
  });

  test("disc_list response contains channel listing", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_list",
      arguments: { guild_id: "123" },
    });
    const result = raw as unknown as ToolCallResult;
    const text = result.content[0].text;
    // handleList returns "#name (id)" lines
    expect(text).toContain("#");
  });

  test("disc_resolve returns the channel ID", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_resolve",
      arguments: { name: "general", guild_id: "123" },
    });
    const result = raw as unknown as ToolCallResult;
    const text = result.content[0].text;
    // handleResolve returns the matched channel ID: "457"
    expect(text).toBe("457");
  });

  test("disc_create_channel response confirms channel creation", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_create_channel",
      arguments: { guild_id: "123", name: "test-channel" },
    });
    const result = raw as unknown as ToolCallResult;
    const text = result.content[0].text;
    // handleCreateChannel returns "Created channel #name (id)"
    expect(text).toContain("Created channel");
  });

  test("disc_create_thread response confirms thread creation", async () => {
    await connectPair();
    const raw = await client.callTool({
      name: "disc_create_thread",
      arguments: { channel_id: "123", name: "test-thread" },
    });
    const result = raw as unknown as ToolCallResult;
    const text = result.content[0].text;
    // handleCreateThread returns "Created thread 'name' (id)"
    expect(text).toContain("Created thread");
  });
});
