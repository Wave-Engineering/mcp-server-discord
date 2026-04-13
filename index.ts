#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { handleSend } from "./send.ts";
import { handleRead } from "./read.ts";
import { handleList } from "./list.ts";
import { handleResolve } from "./resolve.ts";
import { handleCreateChannel } from "./create_channel.ts";
import { handleCreateThread } from "./create_thread.ts";
import { log } from "./logger.ts";

const KILL_SWITCH_PATH = join(homedir(), ".claude", "discord-bot.kill");

/**
 * Tool schemas for the disc MCP server.
 *
 * All 6 tools with full parameter definitions.
 */
export const TOOLS: Tool[] = [
  {
    name: "disc_send",
    description: "Send a message to a Discord channel",
    inputSchema: {
      type: "object" as const,
      properties: {
        channel_id: {
          type: "string",
          description: "The Discord channel ID to send the message to",
        },
        message: {
          type: "string",
          description: "The message content to send",
        },
        embed: {
          type: "string",
          description: "Optional embed in 'title:body' format (split on first colon)",
        },
        attach_path: {
          type: "string",
          description: "Optional local file path to attach to the last message chunk",
        },
      },
      required: ["channel_id", "message"],
    },
  },
  {
    name: "disc_read",
    description: "Read recent messages from a Discord channel",
    inputSchema: {
      type: "object" as const,
      properties: {
        channel_id: {
          type: "string",
          description: "The Discord channel ID to read messages from",
        },
        limit: {
          type: "number",
          description: "Number of messages to retrieve (default: 20)",
        },
      },
      required: ["channel_id"],
    },
  },
  {
    name: "disc_list",
    description: "List all channels in a Discord guild, filtered by type",
    inputSchema: {
      type: "object" as const,
      properties: {
        guild_id: {
          type: "string",
          description: "The Discord guild (server) ID to list channels for",
        },
        type: {
          type: "string",
          enum: ["text", "voice", "category"],
          description: "Channel type to list (default: text)",
        },
      },
      required: ["guild_id"],
    },
  },
  {
    name: "disc_resolve",
    description: "Resolve a Discord channel, user, or role by name",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The name to resolve",
        },
        guild_id: {
          type: "string",
          description: "The Discord guild ID to search within",
        },
        type: {
          type: "string",
          enum: ["channel", "user", "role"],
          description: "The entity type to resolve (channel, user, or role)",
        },
      },
      required: ["name", "guild_id"],
    },
  },
  {
    name: "disc_create_channel",
    description: "Create a new channel in a Discord guild",
    inputSchema: {
      type: "object" as const,
      properties: {
        guild_id: {
          type: "string",
          description: "The Discord guild ID to create the channel in",
        },
        name: {
          type: "string",
          description: "The name for the new channel",
        },
        type: {
          type: "string",
          enum: ["text", "voice", "category"],
          description: "The channel type (default: text)",
        },
      },
      required: ["guild_id", "name"],
    },
  },
  {
    name: "disc_create_thread",
    description: "Create a thread in a Discord channel",
    inputSchema: {
      type: "object" as const,
      properties: {
        channel_id: {
          type: "string",
          description: "The Discord channel ID to create the thread in",
        },
        name: {
          type: "string",
          description: "The name for the new thread",
        },
        message: {
          type: "string",
          description: "An optional initial message for the thread",
        },
      },
      required: ["channel_id", "name"],
    },
  },
];

/**
 * Placeholder handler map — returns "not implemented" for all tools.
 * Real implementations will be added in subsequent issues.
 */
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

// Read DISCORD_TOKEN from environment
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

if (!DISCORD_TOKEN) {
  log.warn("startup", { config: { token_set: false } }, "DISCORD_TOKEN not set — tools will not function");
}

// Check kill switch on startup
if (existsSync(KILL_SWITCH_PATH)) {
  log.error("startup", { config: { kill_switch: true } }, "Kill switch active — disc-server refusing to start");
  process.exit(1);
}

const server = new Server(
  { name: "disc-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

log.info("startup", { version: "1.0.0", config: { tools: TOOLS.length, kill_switch: false } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Re-check kill switch on every tool call
  if (existsSync(KILL_SWITCH_PATH)) {
    return {
      content: [{ type: "text" as const, text: "Kill switch is active — disc-server is disabled" }],
      isError: true,
    };
  }

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

const transport = new StdioServerTransport();
await server.connect(transport);
