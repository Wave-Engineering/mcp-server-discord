# Manual Verification Procedures

This document records manual verification (MV) procedures that require a live
Discord bot session and cannot be executed in a headless CI environment.

---

## MV-01: Live End-to-End Bot Connectivity

**Status: PENDING — requires manual execution with live Discord bot**

### Purpose

Verify that the disc MCP server connects to the real Discord API, sends a
message to a real channel, and reads it back — confirming the full auth and
network path with an actual bot token.

### Prerequisites

- `DISCORD_BOT_TOKEN` set to a valid bot token with `Send Messages` and
  `Read Message History` permissions in the test channel.
- `~/.claude/discord.json` present with the following shape:

  ```json
  {
    "guild_id": "<your-guild-id>",
    "channels": {
      "test": { "id": "<test-channel-id>" },
      "roll-call": { "id": "<roll-call-channel-id>" }
    }
  }
  ```

- Bot is a member of the guild and has been granted the required channel
  permissions.
- Kill file (`~/.claude/discord-bot.kill`) must **not** exist before running.

### Procedure

1. **Set up environment**

   ```bash
   export DISCORD_BOT_TOKEN=<your-real-token>
   ```

2. **Read test channel ID from config**

   ```bash
   TEST_CHANNEL=$(jq -r '.channels.test.id' ~/.claude/discord.json)
   GUILD_ID=$(jq -r '.guild_id' ~/.claude/discord.json)
   echo "Guild: $GUILD_ID  |  Test channel: $TEST_CHANNEL"
   ```

3. **Send a timestamped message**

   Using the disc MCP server (via Claude Code with the server registered), call:

   ```
   disc_send(channel_id=$TEST_CHANNEL, message="MV-01 probe $(date -u +%Y-%m-%dT%H:%M:%SZ)")
   ```

   Expected result: `Message sent to <channel_id> (1 chunk)`

4. **Read it back**

   ```
   disc_read(channel_id=$TEST_CHANNEL, limit=5)
   ```

   Expected result: output contains the timestamp string from step 3.

5. **Resolve a channel by name**

   ```
   disc_resolve(name="test", guild_id=$GUILD_ID)
   ```

   Expected result: returns `$TEST_CHANNEL` (the numeric channel ID).

6. **List channels — verify known channels present**

   ```
   disc_list(guild_id=$GUILD_ID, type="text")
   ```

   Expected result: output contains `#test` and `#roll-call` lines.

7. **Create a temporary channel, verify, then clean up**

   ```
   disc_create_channel(guild_id=$GUILD_ID, name="mv01-temp")
   disc_list(guild_id=$GUILD_ID, type="text")   # must contain #mv01-temp
   ```

   Then delete the channel via the Discord developer portal or bot API to
   avoid leaving test debris.

8. **Create a thread, read from it**

   ```
   disc_create_thread(channel_id=$TEST_CHANNEL, name="mv01-thread")
   ```

   Expected result: `Created thread 'mv01-thread' (<thread-id>)`

   Navigate to the thread in Discord and confirm it exists.

9. **Kill switch round-trip**

   ```bash
   touch ~/.claude/discord-bot.kill
   disc_send(channel_id=$TEST_CHANNEL, message="should be blocked")
   # Expected: "Kill switch is active (manual — no expiry)"

   rm ~/.claude/discord-bot.kill
   disc_send(channel_id=$TEST_CHANNEL, message="kill switch cleared")
   # Expected: "Message sent to <channel_id> (1 chunk)"
   ```

### Pass Criteria

All 9 steps above complete without error, and each expected result is observed
in the tool output and (where applicable) in the Discord UI.

### Recorded Executions

| Date | Executor | Result | Notes |
|------|----------|--------|-------|
| —    | —        | PENDING | Awaiting first live session |
