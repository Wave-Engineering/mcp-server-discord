/**
 * Smoke tests for the disc MCP server tool registration.
 *
 * Verifies that the server initializes correctly, returns all 6 tools,
 * and routes calls through stub handlers. Uses InMemoryTransport for
 * real MCP protocol round-trips without any mocking.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS } from "../index.ts";

function createServer(): Server {
  const server = new Server(
    { name: "disc-server", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  const HANDLERS: Record<
    string,
    (params: Record<string, unknown>) => Promise<string>
  > = {
    disc_send: async () => "not implemented",
    disc_read: async () => "not implemented",
    disc_list: async () => "not implemented",
    disc_resolve: async () => "not implemented",
    disc_create_channel: async () => "not implemented",
    disc_create_thread: async () => "not implemented",
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = HANDLERS[name];

    if (!handler) {
      return {
        content: [
          { type: "text" as const, text: `Unknown tool: ${name}` },
        ],
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

describe("disc server", () => {
  let server: Server;
  let client: Client;

  afterEach(async () => {
    await client?.close();
    await server?.close();
  });

  async function connectPair() {
    server = createServer();
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

  test("server starts without error", async () => {
    await connectPair();
    expect(server).toBeDefined();
    expect(client).toBeDefined();
  });

  test("list tools returns 6 tools", async () => {
    await connectPair();
    const result = await client.listTools();
    expect(result.tools).toHaveLength(6);
  });

  test("tool names are correct", async () => {
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

  test("calling a registered tool returns not implemented", async () => {
    await connectPair();
    const result = await client.callTool({
      name: "disc_send",
      arguments: { channel_id: "123", message: "hello" },
    });
    expect(result.content).toEqual([
      { type: "text", text: "not implemented" },
    ]);
    expect(result.isError).toBeFalsy();
  });

  test("calling an unknown tool returns error", async () => {
    await connectPair();
    const result = await client.callTool({
      name: "nonexistent_tool",
      arguments: {},
    });
    expect(result.content).toEqual([
      { type: "text", text: "Unknown tool: nonexistent_tool" },
    ]);
    expect(result.isError).toBe(true);
  });

  test("disc_send schema requires channel_id and message", async () => {
    await connectPair();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "disc_send");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("channel_id");
    expect(tool!.inputSchema.required).toContain("message");
  });

  test("disc_read schema requires channel_id, limit is optional", async () => {
    await connectPair();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "disc_read");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("channel_id");
    expect(tool!.inputSchema.required).not.toContain("limit");
  });

  test("disc_list schema requires guild_id", async () => {
    await connectPair();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "disc_list");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("guild_id");
  });

  test("disc_resolve schema requires name and guild_id", async () => {
    await connectPair();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "disc_resolve");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("name");
    expect(tool!.inputSchema.required).toContain("guild_id");
  });

  test("disc_create_channel schema requires guild_id and name", async () => {
    await connectPair();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "disc_create_channel");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("guild_id");
    expect(tool!.inputSchema.required).toContain("name");
  });

  test("disc_create_thread schema requires channel_id and name", async () => {
    await connectPair();
    const result = await client.listTools();
    const tool = result.tools.find((t) => t.name === "disc_create_thread");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.required).toContain("channel_id");
    expect(tool!.inputSchema.required).toContain("name");
  });
});
