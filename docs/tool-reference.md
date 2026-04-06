# Tool Reference — mcp-server-discord

Full parameter reference for all 6 `disc_*` MCP tools exposed by `disc-server`.

---

## Table of Contents

1. [disc_send](#disc_send)
2. [disc_read](#disc_read)
3. [disc_list](#disc_list)
4. [disc_resolve](#disc_resolve)
5. [disc_create_channel](#disc_create_channel)
6. [disc_create_thread](#disc_create_thread)
7. [Shared Error Strings](#shared-error-strings)
8. [Config Fallback Chain](#config-fallback-chain)

---

## disc_send

Send a message to a Discord channel. Messages over 2000 characters are split and sent as numbered parts.

### Parameters

| Name | Type | Required | Default | Constraints |
|------|------|----------|---------|-------------|
| `channel_id` | string | yes | — | Discord channel snowflake ID |
| `message` | string | yes | — | Arbitrary text content |
| `embed` | string | no | — | Format: `title:body` (split on first colon only) |
| `attach_path` | string | no | — | Absolute path to a local file; attached to the last chunk via multipart/form-data |

### Behavior

- If `message.length <= 2000`, a single POST is made to `/channels/{channel_id}/messages`.
- If `message.length > 2000`, the text is split on word boundaries into N chunks of ≤2000 characters each. Each chunk is prefixed `(1/N)`, `(2/N)`, …, `(N/N)`.
- Chunks 1 through N-1 are sent as plain JSON. The last chunk is sent with any `embed` and/or `attach_path` if provided.
- If `attach_path` is set, the last request uses `multipart/form-data` with a `payload_json` part and a `files[0]` part.
- If `embed` is set (with or without attachment), the parsed title/description are appended to the last chunk's request body as an `embeds` array.

### Return Values

| Condition | Return String |
|-----------|---------------|
| Single chunk sent successfully | `Message sent to {channel_id} (1 chunk)` |
| Multiple chunks sent successfully | `Message sent to {channel_id} ({N} chunks)` |
| With attachment | `Message sent to {channel_id} ({N} chunk(s), with attachment)` |
| Kill switch active (timed) | `Kill switch is active (expires at {ISO timestamp})` |
| Kill switch active (manual) | `Kill switch is active (manual — no expiry)` |
| Error sending chunk N | `Error sending chunk {N}/{total}: HTTP {status}: {body}` |
| Error sending with attachment | `Error sending attachment: HTTP {status}: {body}` |
| Error sending plain message | `Error sending message: HTTP {status}: {body}` |
| Network error | `Network error: {message}` |
| Rate limited (429) | `HTTP 429: rate limited — kill switch engaged. {body}` |

---

## disc_read

Read recent messages from a Discord channel. Output is in chronological order (oldest first).

### Parameters

| Name | Type | Required | Default | Constraints |
|------|------|----------|---------|-------------|
| `channel_id` | string | yes | — | Discord channel snowflake ID |
| `limit` | number | no | 20 | Clamped to range [1, 100]; non-numeric or ≤0 values fall back to default |

### Behavior

- GETs `/channels/{channel_id}/messages?limit={limit}`.
- Discord returns messages newest-first; the response is reversed before formatting.
- Each message is formatted as `[{ISO timestamp}] <{username}>: {content}`.

### Return Values

| Condition | Return String |
|-----------|---------------|
| Messages found | Newline-separated digest, one message per line |
| No messages | `No messages found` |
| `channel_id` empty | `Error: channel_id is required` |
| Kill switch active (timed) | `Kill switch is active (expires at {ISO timestamp})` |
| Kill switch active (manual) | `Kill switch is active (manual — no expiry)` |
| API error | `Error: HTTP {status}: {body}` |
| Network error | `Error: Network error: {message}` |

### Output Format

```
[2026-04-06T10:00:00.000Z] <alice>: Hello
[2026-04-06T10:01:15.000Z] <bot>: Build passed
```

---

## disc_list

List channels in a Discord guild, filtered by type and sorted by position.

### Parameters

| Name | Type | Required | Default | Constraints |
|------|------|----------|---------|-------------|
| `guild_id` | string | yes | — | Discord guild snowflake ID |
| `type` | string | no | `text` | One of: `text`, `voice`, `category` |

### Type Mapping

| `type` value | Discord channel type integer |
|--------------|------------------------------|
| `text` | 0 |
| `voice` | 2 |
| `category` | 4 |

### Behavior

- GETs `/guilds/{guild_id}/channels`.
- Filters by the requested Discord type integer.
- Sorts remaining channels by `position` ascending.

### Return Values

| Condition | Return String |
|-----------|---------------|
| Channels found | Newline-separated list: `#{name} ({id})` per line |
| No channels match | `No channels found` |
| `guild_id` empty | `Error: guild_id is required` |
| Unknown `type` value | `Error: unknown type "{value}" — must be text, voice, or category` |
| Kill switch active (timed) | `Kill switch is active (expires at {ISO timestamp})` |
| Kill switch active (manual) | `Kill switch is active (manual — no expiry)` |
| API error | `Error: HTTP {status}: {body}` |

### Output Format

```
#general (9876543210987654321)
#dev-ops (9876543210987654322)
#releases (9876543210987654323)
```

---

## disc_resolve

Resolve a Discord channel name to its channel ID within a guild.

### Parameters

| Name | Type | Required | Constraints |
|------|------|----------|-------------|
| `name` | string | yes | Channel name; leading `#` is stripped before matching |
| `guild_id` | string | yes | Discord guild snowflake ID |

### Behavior

- GETs `/guilds/{guild_id}/channels`.
- Normalizes the input `name`: strips a leading `#`, lowercases the result.
- Matches against `channel.name.toLowerCase()`.
- Returns the first match's `id`.

### Return Values

| Condition | Return String |
|-----------|---------------|
| Match found | Raw channel snowflake ID (e.g. `9876543210987654321`) |
| No match | `Channel '#{normalized_name}' not found in guild` |
| Kill switch active (timed) | `Kill switch is active (expires at {ISO timestamp})` |
| Kill switch active (manual) | `Kill switch is active (manual — no expiry)` |
| API error | `Error: HTTP {status}: {body}` |

---

## disc_create_channel

Create a new text channel in a Discord guild.

### Parameters

| Name | Type | Required | Constraints |
|------|------|----------|-------------|
| `guild_id` | string | yes | Discord guild snowflake ID |
| `name` | string | yes | Channel name; sanitized before use |
| `topic` | string | no | Channel topic (passed as-is to the API) |
| `category_id` | string | no | Parent category channel snowflake ID |

### Name Sanitization

The `name` value is sanitized before the API call:

1. All `#` characters are stripped.
2. Whitespace runs are replaced with `-`.
3. The result is lowercased.

Example: `"My Feature #1"` → `"my-feature-1"`

### Behavior

- POSTs to `/guilds/{guild_id}/channels` with `type: 0` (text channel).
- Includes `topic` and `parent_id` (from `category_id`) only when provided.

### Return Values

| Condition | Return String |
|-----------|---------------|
| Channel created | `Created channel #{sanitized_name} ({channel_id})` |
| `guild_id` empty | `Error: guild_id is required` |
| `name` empty | `Error: name is required` |
| Kill switch active (timed) | `Kill switch is active (expires at {ISO timestamp})` |
| Kill switch active (manual) | `Kill switch is active (manual — no expiry)` |
| API error | `Error: HTTP {status}: {body}` |

---

## disc_create_thread

Create a public thread (Discord type 11) in a channel.

### Parameters

| Name | Type | Required | Default | Constraints |
|------|------|----------|---------|-------------|
| `channel_id` | string | yes | — | Discord channel snowflake ID |
| `name` | string | yes | — | Thread name |
| `auto_archive` | number | no | 1440 | Must be one of: `60`, `1440`, `4320`, `10080` |

### Auto-Archive Durations

| Value | Duration |
|-------|----------|
| `60` | 1 hour |
| `1440` | 1 day (default) |
| `4320` | 3 days |
| `10080` | 7 days |

### Behavior

- Validates `auto_archive` before making any API call; returns an error immediately if the value is not in the allowed set.
- POSTs to `/channels/{channel_id}/threads` with `type: 11` (public thread).

### Return Values

| Condition | Return String |
|-----------|---------------|
| Thread created | `Created thread '{name}' ({thread_id})` |
| `channel_id` empty | `Error: channel_id is required` |
| `name` empty | `Error: name is required` |
| Invalid `auto_archive` | `Error: auto_archive must be one of 60, 1440, 4320, 10080` |
| Kill switch active (timed) | `Kill switch is active (expires at {ISO timestamp})` |
| Kill switch active (manual) | `Kill switch is active (manual — no expiry)` |
| API error | `Error: HTTP {status}: {body}` |

---

## Shared Error Strings

These error strings may be returned by any tool.

| Error String | Cause |
|-------------|-------|
| `Kill switch is active (expires at {ISO})` | Kill file exists with a future timestamp |
| `Kill switch is active (manual — no expiry)` | Kill file exists but is empty or non-numeric |
| `HTTP 429: rate limited — kill switch engaged. {body}` | Discord API returned 429; kill switch written for 30 min |
| `HTTP {status}: {body}` | Discord API returned a 4xx or 5xx error |
| `Network error: {message}` | `fetch()` threw (DNS failure, connection refused, etc.) |
| `Failed to parse response: {message}` | Discord API returned non-JSON on a success status |

---

## Config Fallback Chain

```
┌─────────────────────────────────────────────────┐
│             Config resolution order              │
│                                                  │
│  1. ~/.claude/discord.json (key lookup)          │
│        │                                         │
│        └─► not present / missing key             │
│                   │                              │
│  2.               └─► Environment variable       │
│                              │                   │
│                              └─► not set         │
│                                       │          │
│  3.                                   └─► Hardcoded default   │
└─────────────────────────────────────────────────┘

Token resolution order:
  1. DISCORD_BOT_TOKEN environment variable
  2. ~/secrets/discord-bot-token file
  3. Error: "Discord bot token not found"

Kill switch file: ~/.claude/discord-bot.kill
  - absent        → inactive
  - empty         → manual kill (indefinite)
  - future epoch ms → timed kill (auto-cleared on expiry)
  - past epoch ms  → auto-deleted, inactive
```

---

## Tool Source Files

| Tool | Implementation | Tests |
|------|---------------|-------|
| `disc_send` | `send.ts` | `tests/send.test.ts` |
| `disc_read` | `read.ts` | `tests/read.test.ts` |
| `disc_list` | `list.ts` | `tests/list.test.ts` |
| `disc_resolve` | `resolve.ts` | `tests/resolve.test.ts` |
| `disc_create_channel` | `create_channel.ts` | `tests/create_channel.test.ts` |
| `disc_create_thread` | `create_thread.ts` | `tests/create_thread.test.ts` |

MCP server entry point: `index.ts`
Shared modules: `config.ts`, `kill.ts`, `api.ts`
