# Changelog

## [1.0.0] — 2026-04-06

Initial release of `mcp-server-discord` — a Bun/TypeScript MCP server that exposes Discord operations as first-class MCP tools for Claude Code agents.

### Features

- **`disc_send`** — Send messages to any Discord channel; auto-splits messages over 2000 characters into numbered parts; supports optional embeds (`title:body`) and file attachments via multipart/form-data.
- **`disc_read`** — Read recent messages from a channel; output is formatted as a chronological digest (`[timestamp] <author>: content`); configurable limit (1–100, default 20).
- **`disc_list`** — List channels in a guild filtered by type (`text`, `voice`, `category`), sorted by position.
- **`disc_resolve`** — Resolve a channel name to its Discord ID within a guild; case-insensitive matching with `#` stripping.
- **`disc_create_channel`** — Create a new text channel with optional topic and parent category; name is sanitized (spaces → hyphens, lowercased).
- **`disc_create_thread`** — Create a public thread in a channel with configurable auto-archive duration (60, 1440, 4320, or 10080 minutes).

### Infrastructure

- Kill switch (`~/.claude/discord-bot.kill`): manual, timed, and auto-clear modes; automatically engaged on Discord API 429 responses for 30 minutes.
- Token resolution fallback chain: `DISCORD_BOT_TOKEN` env var → `~/secrets/discord-bot-token` file.
- Config fallback chain: `~/.claude/discord.json` → environment variable → hardcoded defaults.
- Compiles to a self-contained binary for Linux x64, macOS arm64, and macOS x64 via `bun build --compile`.
- Registered in `claudecode-workflow/mcps.json` as `disc-server` with a remote install URL.
- `disc/SKILL.md` reduced to a ≤25-line routing stub — no bash snippets or API call patterns.

## [Unreleased]

### Fixed

- **`disc_send`** — Fixed message splitting bug where labeled chunks could exceed 2000 chars on content-dense input (markdown tables, code blocks). The splitter now accounts for label overhead (`(N/M) `) before splitting, ensuring all labeled chunks stay within Discord's 2000-char limit. Fixes #37.
