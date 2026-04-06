/**
 * E2E integration tests for the disc MCP server.
 *
 * All tests are gated on process.env.DISCORD_INTEGRATION_TESTS === "1".
 * When the gate is not set, all tests are skipped (0 tests run from this file).
 *
 * Tests use mocked fetch to simulate Discord API responses, allowing
 * deterministic runs without a live bot token.
 *
 * E2E-01: disc_send → disc_read roundtrip
 * E2E-02: disc_resolve by name → disc_send to resolved ID
 * E2E-03: disc_send with file attachment → verify attachment confirmation
 * E2E-04: Kill switch lifecycle (create → drop; remove → succeed)
 * E2E-05: disc_list → verify known channels present
 * E2E-06: disc_create_thread → disc_read thread
 * E2E-07: disc_create_channel → verify in disc_list → cleanup (delete channel)
 *
 * Discord API shapes used:
 *  disc_send:           POST /channels/{id}/messages  → { id, channel_id, content }
 *  disc_read:           GET  /channels/{id}/messages  → [{ id, timestamp, content, author }]
 *  disc_list:           GET  /guilds/{id}/channels    → [{ id, name, type, position }]
 *  disc_resolve:        GET  /guilds/{id}/channels    → same as disc_list
 *  disc_create_channel: POST /guilds/{id}/channels    → { id, name }
 *  disc_create_thread:  POST /channels/{id}/threads   → { id, name }
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  writeFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { TOOLS } from "../../index.ts";
import { handleSend } from "../../send.ts";
import { handleRead } from "../../read.ts";
import { handleList } from "../../list.ts";
import { handleResolve } from "../../resolve.ts";
import { handleCreateChannel } from "../../create_channel.ts";
import { handleCreateThread } from "../../create_thread.ts";
import { KILL_FILE } from "../../kill.ts";

// ---------------------------------------------------------------------------
// Gate: skip all tests unless DISCORD_INTEGRATION_TESTS=1
// ---------------------------------------------------------------------------

const INTEGRATION_ENABLED = process.env.DISCORD_INTEGRATION_TESTS === "1";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_GUILD_ID = "111111111111111111";
const TEST_CHANNEL_ID = "222222222222222222";
const TEST_THREAD_CHANNEL_ID = "333333333333333333";

const TIMESTAMP_FIXED = "2026-01-15T12:00:00.000Z";

// A message that will be "sent" and "read back" in E2E-01
const ROUNDTRIP_MESSAGE_CONTENT = `e2e-roundtrip-${Date.now()}`;

// Mock Discord API responses
const MOCK_SENT_MESSAGE = {
  id: "999000000000000001",
  channel_id: TEST_CHANNEL_ID,
  content: ROUNDTRIP_MESSAGE_CONTENT,
};

const MOCK_READ_MESSAGES = [
  {
    id: "999000000000000001",
    timestamp: TIMESTAMP_FIXED,
    content: ROUNDTRIP_MESSAGE_CONTENT,
    author: { id: "bot-user-id", username: "disc-bot" },
  },
];

const MOCK_CHANNELS_LIST = [
  { id: TEST_CHANNEL_ID, name: "test-channel", type: 0, position: 1 },
  { id: "444444444444444444", name: "general", type: 0, position: 0 },
  { id: "555555555555555555", name: "roll-call", type: 0, position: 2 },
];

const MOCK_NEW_CHANNEL = {
  id: "666666666666666666",
  name: "e2e-temp-channel",
};

const MOCK_THREAD = {
  id: "777777777777777777",
  name: "e2e-test-thread",
};

const MOCK_THREAD_MESSAGES = [
  {
    id: "888000000000000001",
    timestamp: TIMESTAMP_FIXED,
    content: "thread starter message",
    author: { id: "bot-user-id", username: "disc-bot" },
  },
];

// ---------------------------------------------------------------------------
// Mock fetch builder
//
// Returns different Discord API shapes based on the URL/method combination.
// After disc_create_channel, the new channel is inserted so disc_list can find it.
// ---------------------------------------------------------------------------

interface MockState {
  createdChannels: Array<{ id: string; name: string; type: number; position: number }>;
}

function buildMockFetch(state: MockState): unknown {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";

    let payload: unknown;

    if (url.includes("/threads")) {
      // POST /channels/{id}/threads → thread object
      payload = MOCK_THREAD;
    } else if (url.includes("/messages")) {
      if (method === "POST") {
        // POST /channels/{id}/messages → sent message object
        payload = MOCK_SENT_MESSAGE;
      } else if (url.includes(TEST_THREAD_CHANNEL_ID)) {
        // GET messages in thread channel
        payload = MOCK_THREAD_MESSAGES;
      } else {
        // GET /channels/{id}/messages → array (newest-first in real API)
        payload = [...MOCK_READ_MESSAGES].reverse();
      }
    } else if (url.includes("/channels") && !url.includes("/guilds")) {
      // DELETE /channels/{id} → empty 200 (channel delete)
      payload = {};
    } else if (url.includes("/guilds")) {
      if (method === "POST") {
        // POST /guilds/{id}/channels → new channel
        state.createdChannels.push({
          id: MOCK_NEW_CHANNEL.id,
          name: MOCK_NEW_CHANNEL.name,
          type: 0,
          position: 99,
        });
        payload = MOCK_NEW_CHANNEL;
      } else {
        // GET /guilds/{id}/channels → channels array (including any created ones)
        payload = [...MOCK_CHANNELS_LIST, ...state.createdChannels];
      }
    } else {
      payload = {};
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// ---------------------------------------------------------------------------
// Server + Client factory
// ---------------------------------------------------------------------------

interface ConnectedPair {
  server: Server;
  client: Client;
}

async function connectPair(): Promise<ConnectedPair> {
  const server = new Server(
    { name: "disc-server-e2e", version: "1.0.0" },
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
    return { content: [{ type: "text" as const, text: result }] };
  });

  const client = new Client(
    { name: "e2e-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { server, client };
}

// ---------------------------------------------------------------------------
// Helper: extract text from tool call result
// ---------------------------------------------------------------------------

interface ToolCallResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

function getText(raw: unknown): string {
  return ((raw as ToolCallResult).content[0] ?? { text: "" }).text;
}

// ---------------------------------------------------------------------------
// Suite — gated on DISCORD_INTEGRATION_TESTS=1
// ---------------------------------------------------------------------------

const describeIf = INTEGRATION_ENABLED ? describe : describe.skip;

describeIf("E2E: disc MCP server integration", () => {
  let server: Server;
  let client: Client;
  let originalFetch: typeof globalThis.fetch;
  let originalToken: string | undefined;
  let mockState: MockState;

  beforeEach(() => {
    mockState = { createdChannels: [] };

    // Stash real fetch and inject mock
    originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    globalThis.fetch = buildMockFetch(mockState) as any;

    // Set bot token so getToken() succeeds
    originalToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "e2e-test-bot-token";

    // Ensure kill switch is not active
    mkdirSync(join(homedir(), ".claude"), { recursive: true });
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

    // Clean up kill file if a test left one
    if (existsSync(KILL_FILE)) {
      unlinkSync(KILL_FILE);
    }

    await client?.close();
    await server?.close();
  });

  // -------------------------------------------------------------------------
  // E2E-01: disc_send → disc_read roundtrip
  // -------------------------------------------------------------------------

  test("E2E-01: disc_send → disc_read roundtrip", async () => {
    ({ server, client } = await connectPair());

    // Send a timestamped message
    const sendRaw = await client.callTool({
      name: "disc_send",
      arguments: {
        channel_id: TEST_CHANNEL_ID,
        message: ROUNDTRIP_MESSAGE_CONTENT,
      },
    });
    const sendText = getText(sendRaw);
    expect(sendText).toContain("sent");
    expect(sendText).toContain(TEST_CHANNEL_ID);

    // Read it back — message should appear in the result
    const readRaw = await client.callTool({
      name: "disc_read",
      arguments: { channel_id: TEST_CHANNEL_ID, limit: 5 },
    });
    const readText = getText(readRaw);
    expect(readText).toContain(ROUNDTRIP_MESSAGE_CONTENT);
    expect(readText).toContain("disc-bot");
  });

  // -------------------------------------------------------------------------
  // E2E-02: disc_resolve by name → disc_send to resolved ID
  // -------------------------------------------------------------------------

  test("E2E-02: disc_resolve by name → disc_send to resolved ID", async () => {
    ({ server, client } = await connectPair());

    // Resolve "test-channel" to its ID
    const resolveRaw = await client.callTool({
      name: "disc_resolve",
      arguments: { name: "test-channel", guild_id: TEST_GUILD_ID },
    });
    const resolvedId = getText(resolveRaw);
    expect(resolvedId).toBe(TEST_CHANNEL_ID);

    // Send to the resolved ID
    const sendRaw = await client.callTool({
      name: "disc_send",
      arguments: {
        channel_id: resolvedId,
        message: "E2E-02: sent via resolved channel ID",
      },
    });
    const sendText = getText(sendRaw);
    expect(sendText).toContain("sent");
    expect(sendText).toContain(resolvedId);
  });

  // -------------------------------------------------------------------------
  // E2E-03: disc_send with file attachment → verify attachment confirmation
  // -------------------------------------------------------------------------

  test("E2E-03: disc_send with file attachment", async () => {
    ({ server, client } = await connectPair());

    // Create a temp file to attach
    const tmpFile = join(tmpdir(), `e2e-attach-${Date.now()}.txt`);
    writeFileSync(tmpFile, "E2E-03 attachment content", "utf-8");

    const sendRaw = await client.callTool({
      name: "disc_send",
      arguments: {
        channel_id: TEST_CHANNEL_ID,
        message: "E2E-03: message with attachment",
        attach_path: tmpFile,
      },
    });
    const sendText = getText(sendRaw);
    // handleSend confirms with "attachment" in the result for attach_path calls
    expect(sendText).toContain("attachment");
    expect(sendText).toContain(TEST_CHANNEL_ID);
  });

  // -------------------------------------------------------------------------
  // E2E-04: Kill switch lifecycle
  //   Phase A: create kill file → next request is dropped with kill error
  //   Phase B: remove kill file → request succeeds
  // -------------------------------------------------------------------------

  test("E2E-04: kill switch lifecycle — create → drop; remove → succeed", async () => {
    ({ server, client } = await connectPair());

    // Phase A: engage the kill switch
    writeFileSync(KILL_FILE, "", "utf-8");

    const blockedRaw = await client.callTool({
      name: "disc_send",
      arguments: {
        channel_id: TEST_CHANNEL_ID,
        message: "E2E-04: this should be blocked",
      },
    });
    const blockedText = getText(blockedRaw);
    expect(blockedText).toContain("Kill switch is active");

    // Phase B: remove the kill file — next call should succeed
    unlinkSync(KILL_FILE);

    const successRaw = await client.callTool({
      name: "disc_send",
      arguments: {
        channel_id: TEST_CHANNEL_ID,
        message: "E2E-04: this should succeed",
      },
    });
    const successText = getText(successRaw);
    expect(successText).toContain("sent");
  });

  // -------------------------------------------------------------------------
  // E2E-05: disc_list → verify known channels present
  // -------------------------------------------------------------------------

  test("E2E-05: disc_list → known channels present", async () => {
    ({ server, client } = await connectPair());

    const listRaw = await client.callTool({
      name: "disc_list",
      arguments: { guild_id: TEST_GUILD_ID, type: "text" },
    });
    const listText = getText(listRaw);

    // Known channels from mock: test-channel, general, roll-call
    expect(listText).toContain("#general");
    expect(listText).toContain("#test-channel");
    expect(listText).toContain("#roll-call");

    // Each line should contain the id in parentheses
    expect(listText).toContain(`(${TEST_CHANNEL_ID})`);
  });

  // -------------------------------------------------------------------------
  // E2E-06: disc_create_thread → disc_read thread
  // -------------------------------------------------------------------------

  test("E2E-06: disc_create_thread → disc_read thread", async () => {
    ({ server, client } = await connectPair());

    // Create a thread in the test channel
    const createRaw = await client.callTool({
      name: "disc_create_thread",
      arguments: {
        channel_id: TEST_CHANNEL_ID,
        name: "e2e-test-thread",
      },
    });
    const createText = getText(createRaw);
    expect(createText).toContain("Created thread");
    expect(createText).toContain("e2e-test-thread");

    // Extract thread ID from the confirmation string "Created thread 'name' (id)"
    const threadIdMatch = createText.match(/\((\d+)\)/);
    expect(threadIdMatch).not.toBeNull();
    const threadId = threadIdMatch![1];
    expect(threadId).toBe(MOCK_THREAD.id);

    // Read from the thread channel (thread messages)
    const readRaw = await client.callTool({
      name: "disc_read",
      arguments: { channel_id: TEST_THREAD_CHANNEL_ID, limit: 5 },
    });
    const readText = getText(readRaw);
    // Thread has its own messages from the mock
    expect(readText).toContain("thread starter message");
  });

  // -------------------------------------------------------------------------
  // E2E-07: disc_create_channel → verify in disc_list → cleanup (delete channel)
  // -------------------------------------------------------------------------

  test("E2E-07: disc_create_channel → disc_list includes it → cleanup", async () => {
    ({ server, client } = await connectPair());

    const newChannelName = "e2e-temp-channel";

    // Create the channel
    const createRaw = await client.callTool({
      name: "disc_create_channel",
      arguments: {
        guild_id: TEST_GUILD_ID,
        name: newChannelName,
      },
    });
    const createText = getText(createRaw);
    expect(createText).toContain("Created channel");
    expect(createText).toContain(newChannelName);

    // Extract created channel ID
    const newIdMatch = createText.match(/\((\d+)\)/);
    expect(newIdMatch).not.toBeNull();
    const newChannelId = newIdMatch![1];
    expect(newChannelId).toBe(MOCK_NEW_CHANNEL.id);

    // Verify it appears in disc_list (mock state was updated by the POST)
    const listRaw = await client.callTool({
      name: "disc_list",
      arguments: { guild_id: TEST_GUILD_ID, type: "text" },
    });
    const listText = getText(listRaw);
    expect(listText).toContain(`#${newChannelName}`);
    expect(listText).toContain(`(${newChannelId})`);

    // Cleanup: delete the channel via direct fetch (simulated — mock returns 200)
    // We verify the mock fetch handles the delete path cleanly.
    const deleteResponse = await globalThis.fetch(
      `https://discord.com/api/v10/channels/${newChannelId}`,
      {
        method: "DELETE",
        headers: { Authorization: "Bot e2e-test-bot-token" },
      }
    );
    expect(deleteResponse.status).toBe(200);
  });
});
