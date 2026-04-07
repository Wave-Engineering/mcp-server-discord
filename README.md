# mcp-server-discord

![CI](https://github.com/Wave-Engineering/mcp-server-discord/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/github/license/Wave-Engineering/mcp-server-discord)

MCP server for Discord channel management and messaging — send, read, list, resolve, and create channels and threads from Claude Code.

## Quickstart

**Step 1 — Install the binary**

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Wave-Engineering/mcp-server-discord/main/scripts/install-remote.sh)
```

This downloads the correct platform binary to `~/.local/bin/disc-server` and registers the `disc-server` MCP server in `~/.claude.json`.

**Step 2 — Configure your bot token**

Place your Discord bot token in `~/secrets/discord-bot-token`:

```bash
mkdir -p ~/secrets
echo "your-bot-token-here" > ~/secrets/discord-bot-token
chmod 600 ~/secrets/discord-bot-token
```

Alternatively, export `DISCORD_BOT_TOKEN` in your shell environment.

If your token file lives somewhere other than `~/secrets/discord-bot-token`, set `DISCORD_TOKEN_FILE` to override the path:

```bash
export DISCORD_TOKEN_FILE=~/secrets/discord-cc-dev-bot-account
```

**Step 3 — Use `/disc` in Claude Code**

Start a Claude Code session and invoke the `/disc` skill:

```
/disc send #general Hello from Claude Code!
```

The skill routes to the `disc_send` MCP tool, which calls the Discord REST API directly.

---

## Tools

| Tool | Description |
|------|-------------|
| `disc_send` | Send a message to a channel |
| `disc_read` | Read recent messages from a channel |
| `disc_list` | List all channels in a guild |
| `disc_resolve` | Resolve a channel name to its ID |
| `disc_create_channel` | Create a new channel in a guild |
| `disc_create_thread` | Create a thread in a channel |

### disc_send

Send a message to a Discord channel. Messages over 2000 characters are automatically split into numbered parts.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel_id` | string | yes | Discord channel ID |
| `message` | string | yes | Message content |
| `embed` | string | no | Embed in `title:body` format (split on first colon) |
| `attach_path` | string | no | Local file path to attach to the last chunk |

**Example**

```json
{
  "channel_id": "1234567890123456789",
  "message": "Deployment complete — all systems green."
}
```

**Return value**

```
Message sent to 1234567890123456789 (1 chunk)
```

For multi-part messages:

```
Message sent to 1234567890123456789 (3 chunks)
```

With attachment:

```
Message sent to 1234567890123456789 (1 chunk, with attachment)
```

---

### disc_read

Read recent messages from a Discord channel.

**Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel_id` | string | yes | — | Discord channel ID |
| `limit` | number | no | 20 | Number of messages to retrieve (max 100) |

**Example**

```json
{
  "channel_id": "1234567890123456789",
  "limit": 10
}
```

**Return value**

Messages formatted chronologically (oldest first), one per line:

```
[2026-04-06T10:00:00.000Z] <alice>: Deploy started
[2026-04-06T10:02:34.000Z] <bot>: Build passed
[2026-04-06T10:03:11.000Z] <alice>: Looks good
```

---

### disc_list

List channels in a Discord guild, sorted by position.

**Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `guild_id` | string | yes | — | Discord guild (server) ID |
| `type` | string | no | `text` | Channel type: `text`, `voice`, or `category` |

**Example**

```json
{
  "guild_id": "1234567890123456789",
  "type": "text"
}
```

**Return value**

```
#general (9876543210987654321)
#dev-ops (9876543210987654322)
#releases (9876543210987654323)
```

---

### disc_resolve

Resolve a channel name to its Discord ID within a guild. Name matching is case-insensitive and strips a leading `#`.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Channel name to look up (with or without `#`) |
| `guild_id` | string | yes | Discord guild ID to search within |

**Example**

```json
{
  "name": "#general",
  "guild_id": "1234567890123456789"
}
```

**Return value**

```
9876543210987654321
```

On failure:

```
Channel '#general' not found in guild
```

---

### disc_create_channel

Create a new text channel in a Discord guild. The name is sanitized: spaces become hyphens, `#` is stripped, and the result is lowercased.

**Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `guild_id` | string | yes | Discord guild ID |
| `name` | string | yes | Name for the new channel |
| `topic` | string | no | Channel topic |
| `category_id` | string | no | Parent category channel ID |

**Example**

```json
{
  "guild_id": "1234567890123456789",
  "name": "release-notes",
  "topic": "Automated release announcements"
}
```

**Return value**

```
Created channel #release-notes (9876543210987654321)
```

---

### disc_create_thread

Create a public thread (type 11) in a Discord channel.

**Parameters**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `channel_id` | string | yes | — | Discord channel ID |
| `name` | string | yes | — | Thread name |
| `auto_archive` | number | no | 1440 | Auto-archive duration in minutes: `60`, `1440`, `4320`, or `10080` |

**Example**

```json
{
  "channel_id": "1234567890123456789",
  "name": "Deploy 2026-04-06",
  "auto_archive": 1440
}
```

**Return value**

```
Created thread 'Deploy 2026-04-06' (9876543210987654321)
```

---

## Configuration

The server reads `~/.claude/discord.json` for guild and channel defaults. All fields are optional — hardcoded defaults are used when the file is absent or a key is missing.

**`~/.claude/discord.json` schema**

```json
{
  "guild_id": "your-guild-id",
  "channel_id": "your-default-channel-id",
  "roll_call_id": "your-roll-call-channel-id",
  "channels": {
    "test": {
      "id": "channel-id-for-e2e-tests"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `guild_id` | Default guild for operations that require one |
| `channel_id` | Default channel for `disc_send` when no channel is specified by the skill |
| `roll_call_id` | Channel used for agent check-ins |
| `channels.test.id` | Test channel for E2E tests |

**Token resolution fallback chain**

```
DISCORD_BOT_TOKEN env var
  └─► File at $DISCORD_TOKEN_FILE (default ~/secrets/discord-bot-token)
        └─► Error: "Discord bot token not found"
```

**Config value fallback chain**

```
~/.claude/discord.json key
  └─► Environment variable
        └─► Hardcoded default
```

---

## Kill Switch

The kill switch prevents all outbound Discord calls. It is automatically engaged when the Discord API returns a 429 rate-limit response (30-minute expiry). You can also engage it manually.

### Automatic engagement (rate limit)

When a 429 response is received, `disc-server` writes a Unix timestamp (ms) to `~/.claude/discord-bot.kill`. All subsequent tool calls are rejected until the timestamp passes, at which point the file is auto-deleted.

### Manual override

To block all Discord calls indefinitely:

```bash
touch ~/.claude/discord-bot.kill
```

To block until a specific time (Unix ms timestamp):

```bash
echo "1746000000000" > ~/.claude/discord-bot.kill
```

To re-enable immediately:

```bash
rm ~/.claude/discord-bot.kill
```

### Kill switch states

| File state | Behavior |
|-----------|----------|
| File absent | Normal operation |
| File empty (no content) | All calls blocked (manual kill, no expiry) |
| File contains future timestamp (ms) | All calls blocked until that time |
| File contains past timestamp (ms) | File auto-deleted, normal operation resumes |

**Error returned when kill switch is active:**

```
Kill switch is active (expires at 2026-04-06T10:30:00.000Z)
```

or for a manual kill:

```
Kill switch is active (manual — no expiry)
```

---

## Development

```bash
bun install
make ci
```

Targets: `lint`, `test`, `build`, `ci`, `e2e`
