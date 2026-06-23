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

## [1.3.0] — 2026-06-23

> The changelog was not maintained across the `1.0.3`–`1.2.2` tags; this entry consolidates the changes published since `[1.0.0]` that were never separately recorded, alongside the new `1.3.0` work (#57, #58). In-repo version (`package.json`, `index.ts`) aligned to the `v1.3.0` tag (#63).

### Added

- **Per-agent webhook identity** — `disc_send` posts under a distinct username and avatar per agent, so multiple agents sharing a channel are visually distinguishable rather than collapsing onto one webhook identity. Fixes #58.

### Fixed

- **Surrogate sanitization** — lone UTF-16 surrogate code units are now sanitized in **both** directions (inbound reads and outbound sends), preventing malformed-Unicode errors at the Discord API boundary. Fixes #57.
- **`disc_send`** — Fixed message splitting bug where labeled chunks could exceed 2000 chars on content-dense input (markdown tables, code blocks). The splitter now accounts for label overhead (`(N/M) `) before splitting, ensuring all labeled chunks stay within Discord's 2000-char limit. Fixes #37.
- **`disc_send`** — Validate the body field before dereferencing. Prior callers that supplied a different field name (most commonly `content`, which is what the upstream Discord REST API itself uses) hit an opaque `text.length` crash inside `splitMessage`. The handler now (a) accepts `content` as an alias for `message`, and (b) returns a structured error naming the missing field plus what was actually received when neither is supplied. Schema in `index.ts` documents the alias. Fixes #50.
- **`tests/config.test.ts`** — Stop destroying real user secrets. Earlier versions of the test wrote and deleted `$HOME/secrets/discord-bot-token` and `$HOME/.claude/discord.json` directly via `homedir()`-derived paths, silently clobbering production secrets on every `bun test` run. Three confirmed losses on developer machines, surfaced via Linux audit log on 2026-04-28. Fix: every test now uses `$DISCORD_TOKEN_FILE` and the new `$DISCORD_CONFIG_FILE` env overrides pointing at a per-test tmpdir. A suite-wide SHA-guard in `beforeAll`/`afterAll` records and verifies the real-path SHAs are unchanged across the suite, failing loudly if any future test regresses isolation. `config.ts` now exposes `$DISCORD_CONFIG_FILE` for parity with the existing `$DISCORD_TOKEN_FILE`. Fixes #52.
