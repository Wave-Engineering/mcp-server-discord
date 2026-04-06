<!-- PRD-APPROVAL
approved: true
approved_by: BJ
approved_at: 2026-04-06T19:51:54Z
finalization_score: 7/7
-->

# mcp-server-discord — Product Requirements Document

**Version:** 1.0
**Date:** 2026-04-06
**Status:** Draft
**Authors:** bakerb, Claude (AI Partner)

---

## Table of Contents

1. [Problem Domain](#1-problem-domain)
2. [Constraints](#2-constraints)
3. [Requirements (EARS Format)](#3-requirements-ears-format)
4. [Concept of Operations](#4-concept-of-operations)
5. [Detailed Design](#5-detailed-design)
   - [5.A Deliverables Manifest](#5a-deliverables-manifest)
   - [5.B Installation & Deployment](#5b-installation--deployment)
6. [Test Plan](#6-test-plan)
7. [Definition of Done](#7-definition-of-done)
8. [Phased Implementation Plan](#8-phased-implementation-plan)
9. [Appendices](#9-appendices)

---

## 1. Problem Domain

### 1.1 Background

Claude Code agents in the cc-workflow kit interact with Discord via two mechanisms:

1. **`disc` skill** (`skills/disc/SKILL.md`) — a 155-line skill file loaded into context whenever `/disc` is invoked. It contains implementation detail: bash snippets, API call patterns, channel resolution logic, and identity formatting.
2. **`discord-bot` bash script** (`~/.local/bin/discord-bot`) — a REST API client that performs the actual Discord calls.

The `discord-watcher` MCP server handles the inbound side (notifications pushed to the agent). The outbound side — sending, reading, creating channels and threads, check-ins — flows entirely through the skill system.

### 1.2 Problem Statement

The `disc/SKILL.md` costs tokens on every turn when active, and its 155 lines of implementation detail (bash snippets, curl patterns) provide no value to the model once MCP tools exist. The skill cannot be reduced below a certain size without replacing its capability. Sessions that compact while Discord is active re-load the full skill on resume, compounding the cost.

### 1.3 Proposed Solution

Build `mcp-server-discord` — a Bun/TypeScript MCP server that exposes Discord operations as first-class MCP tools, following the same pattern as `mcp-server-nerf` and `mcp-server-wtf`. The server calls the Discord REST API directly (no shell-outs). The `disc/SKILL.md` is reduced to a ~20-line routing stub. The `discord-bot` bash script is retained as a standalone CLI for human/script use.

### 1.4 Target Users

| Persona | Description | Primary Use Case |
|---------|-------------|-----------------|
| **Claude Code agent** | Any agent in the cc-workflow kit | Send status messages, read channel history, post check-ins, create threads for work tracking |
| **Wave Engineering human** | Developer using the kit interactively | Same operations invoked via `/disc` skill |

### 1.5 Non-Goals

- **Not a general-purpose Discord bot.** No event listeners, slash commands, or message handlers — outbound REST only.
- **Not a replacement for `discord-watcher`.** Inbound notification handling stays in the watcher MCP.
- **Not a guild management tool.** No role/user management, server settings, or webhook management.
- **Not a replacement for `discord-bot` CLI.** The bash script is retained for human/script use outside Claude Code.

---

## 2. Constraints

### 2.1 Technical Constraints

| ID | Constraint | Rationale |
|----|-----------|-----------|
| CT-01 | Runtime: Bun. Compiled to a single binary via `bun build --compile` | Matches `mcp-server-nerf` and `mcp-server-wtf` pattern; zero runtime dependency for the installed binary |
| CT-02 | Language: TypeScript | Consistent with the MCP server ecosystem in this kit |
| CT-03 | Discord REST API v10 only. No Gateway (WebSocket) connection | Inbound events are out of scope; REST is sufficient for all outbound operations |
| CT-04 | Token sourced from `~/secrets/discord-bot-token` or `DISCORD_BOT_TOKEN` env var; config from `~/.claude/discord.json` | Must be backward-compatible with the existing `discord-bot` fallback chain |
| CT-05 | MCP transport: stdio | Consistent with all other MCP servers in the kit |

### 2.2 Product Constraints

| ID | Constraint | Rationale |
|----|-----------|-----------|
| CP-01 | The `disc/SKILL.md` stub must remain — it cannot be deleted entirely | The `/disc` skill invocation needs a routing file; the goal is minimization, not elimination |
| CP-02 | The `discord-bot` bash script must not be modified or removed | It is a standalone CLI used outside Claude Code and referenced in `install.sh` |
| CP-03 | Registered in `claudecode-workflow/mcps.json` with a remote install URL | Consistent with how `nerf-server`, `wtf-server`, and `discord-watcher` are distributed |
| CP-04 | Kill switch must be honored | Rate limiting protection already exists in `discord-bot`; the MCP server must respect the same `~/.claude/discord-bot.kill` mechanism |

---

## 3. Requirements (EARS Format)

### 3.1 MCP Tool Interface

| ID | Type | Requirement |
|----|------|-------------|
| R-01 | Ubiquitous | The system shall expose a `disc_send` tool that accepts a channel ID, message text, and optional embed and file attachment path. |
| R-02 | Ubiquitous | The system shall expose a `disc_read` tool that accepts a channel ID and optional message limit. |
| R-03 | Ubiquitous | The system shall expose a `disc_list` tool that accepts a guild ID and optional channel type filter. |
| R-04 | Ubiquitous | The system shall expose a `disc_resolve` tool that accepts a guild ID and channel name and returns the channel ID. |
| R-05 | Ubiquitous | The system shall expose a `disc_create_channel` tool that accepts a guild ID, channel name, and optional topic and category ID. |
| R-06 | Ubiquitous | The system shall expose a `disc_create_thread` tool that accepts a channel ID, thread name, and optional auto-archive duration. |

### 3.2 Discord API Behavior

| ID | Type | Requirement |
|----|------|-------------|
| R-07 | Event-driven | When a message exceeds 2000 characters, the system shall split it into numbered parts and send each part sequentially. |
| R-08 | Event-driven | When a file attachment path is provided to `disc_send`, the system shall upload the file as a Discord attachment using multipart/form-data. |
| R-09 | Event-driven | When a Discord API call returns a 4xx or 5xx response, the system shall return an error string describing the status code and response body. |
| R-10 | Event-driven | When a Discord API call returns a 429 (rate limit) response, the system shall engage the kill switch with an expiry timestamp and return an error. |

### 3.3 Configuration & Authentication

| ID | Type | Requirement |
|----|------|-------------|
| R-11 | Ubiquitous | The system shall resolve the bot token using the fallback chain: `DISCORD_BOT_TOKEN` env var → `~/secrets/discord-bot-token` file. |
| R-12 | Ubiquitous | The system shall read guild ID and channel defaults from `~/.claude/discord.json` when present, falling back to hardcoded Oak and Wave defaults. |
| R-13 | Event-driven | When `~/.claude/discord.json` contains invalid JSON, the system shall log a warning to stderr and fall back to hardcoded defaults. |

### 3.4 Safety & Rate Limiting

| ID | Type | Requirement |
|----|------|-------------|
| R-14 | State-driven | While the kill switch file (`~/.claude/discord-bot.kill`) exists and contains a future expiry timestamp, the system shall drop all outbound requests and return a kill-switch-active error. |
| R-15 | State-driven | While the kill switch file exists with no timestamp (manual kill), the system shall drop all outbound requests until the file is removed. |
| R-16 | Event-driven | When the kill switch expiry timestamp has passed, the system shall treat the kill switch as inactive and proceed normally. |

### 3.5 Integration

| ID | Type | Requirement |
|----|------|-------------|
| R-17 | Ubiquitous | The system shall compile to a single self-contained binary for Linux x64, macOS arm64, and macOS x64. |
| R-18 | Ubiquitous | The `claudecode-workflow` repository shall register `disc-server` in `mcps.json` with a remote install URL. |
| R-19 | Ubiquitous | The `disc/SKILL.md` shall be reduced to a routing stub of ≤25 lines that delegates all operations to MCP tool calls. |

---

## 4. Concept of Operations

### 4.1 System Context

```
┌─────────────────────────────────────────────────────┐
│                   Claude Code Session                │
│                                                      │
│  ┌──────────┐    MCP tools      ┌─────────────────┐ │
│  │  Agent   │ ────────────────► │ mcp-server-     │ │
│  │          │ ◄──────────────── │ discord         │ │
│  └──────────┘    tool results   └────────┬────────┘ │
│                                          │           │
│  ┌──────────┐                   reads    │           │
│  │ disc     │  routes to tools ──────────┘           │
│  │ SKILL.md │                                        │
│  │ (stub)   │                                        │
│  └──────────┘                                        │
└──────────────────────────────────┬──────────────────┘
                                   │ HTTPS REST API v10
                              ┌────▼─────┐
                              │ Discord  │
                              │   API    │
                              └──────────┘

Config:  ~/.claude/discord.json
Token:   ~/secrets/discord-bot-token | $DISCORD_BOT_TOKEN
Kill:    ~/.claude/discord-bot.kill
```

### 4.2 Outbound Message Flow (disc_send)

1. Agent calls `disc_send` with channel ID and message text
2. Server checks kill switch — if active, returns error immediately
3. Server resolves bot token from fallback chain
4. If message > 2000 chars, server splits into numbered parts
5. Server POSTs each part to `discord.com/api/v10/channels/{id}/messages`
6. On 429, server engages kill switch with expiry and returns error
7. On success, server returns confirmation string to agent

### 4.3 Channel Resolution Flow (disc_resolve)

1. Agent calls `disc_resolve` with guild ID and channel name
2. Server GETs `discord.com/api/v10/guilds/{guild_id}/channels`
3. Server filters by name (case-insensitive, strips `#` prefix)
4. Returns channel ID string, or an error if not found

### 4.4 Kill Switch Flow

```
Request arrives
      │
      ▼
Kill file exists? ──No──► proceed normally
      │
     Yes
      │
      ▼
Has expiry timestamp? ──No (manual kill)──► drop, return error
      │
     Yes
      │
      ▼
Timestamp in future? ──No (expired)──► delete file, proceed
      │
     Yes
      │
      ▼
Drop request, return error with expiry time
```

---

## 5. Detailed Design

### 5.1 Tool Definitions

Six tools, flat-module convention (one `.ts` file per tool):

| Tool | File | Key Parameters |
|------|------|----------------|
| `disc_send` | `send.ts` | `channel_id`, `message`, `embed?` (`title:body`), `attach_path?` |
| `disc_read` | `read.ts` | `channel_id`, `limit?` (default 20) |
| `disc_list` | `list.ts` | `guild_id`, `type?` (`text`\|`voice`\|`category`) |
| `disc_resolve` | `resolve.ts` | `guild_id`, `channel_name` |
| `disc_create_channel` | `create_channel.ts` | `guild_id`, `name`, `topic?`, `category_id?` |
| `disc_create_thread` | `create_thread.ts` | `channel_id`, `name`, `auto_archive?` (60\|1440\|4320\|10080) |

Shared modules: `config.ts` (discord.json + token resolution), `kill.ts` (kill switch read/write), `api.ts` (fetch wrapper with error handling).

### 5.2 File/Directory Layout

```
mcp-server-discord/
├── index.ts              # MCP server entry, tool registry
├── send.ts
├── read.ts
├── list.ts
├── resolve.ts
├── create_channel.ts
├── create_thread.ts
├── config.ts             # discord.json + token fallback chain
├── kill.ts               # kill switch read/engage/check
├── api.ts                # fetch wrapper, 429 handler
├── dist/
│   └── disc-server-*     # compiled binaries (3 platforms)
├── docs/
│   ├── mcp-server-discord-PRD.md
│   ├── tool-reference.md
│   └── manual-verification.md
├── scripts/
│   ├── ci/
│   │   ├── validate.sh
│   │   └── build.sh
│   └── install-remote.sh
├── tests/
│   ├── smoke.test.ts
│   ├── config.test.ts
│   ├── kill.test.ts
│   ├── api.test.ts
│   ├── send.test.ts
│   ├── read.test.ts
│   ├── list.test.ts
│   ├── resolve.test.ts
│   ├── create_channel.test.ts
│   ├── create_thread.test.ts
│   ├── routing.test.ts
│   └── e2e/
│       └── integration.test.ts
├── reports/
│   ├── junit.xml
│   └── coverage.xml
├── package.json
├── tsconfig.json
├── Makefile
├── README.md
└── CHANGELOG.md
```

### 5.3 Technology Choices

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | Bun | Matches kit pattern; native fetch; `--compile` produces self-contained binary |
| Language | TypeScript | Consistent with nerf and wtf servers |
| MCP SDK | `@modelcontextprotocol/sdk` | Standard across all kit MCP servers |
| HTTP client | `fetch` (Bun built-in) | No extra dependency; handles multipart for attachments |
| Config | `~/.claude/discord.json` | Existing format; backward-compatible |

### 5.4 Disc Skill Stub

`skills/disc/SKILL.md` is reduced to ≤25 lines. The stub:
- Resolves agent identity (Dev-Name, Dev-Avatar, Dev-Team) from the identity file
- Resolves channel from config/args
- Routes the intent to the appropriate `disc_*` MCP tool
- Contains no bash snippets, no API call patterns, no curl examples

### 5.N Open Questions

All open questions resolved during PRD creation:
1. **Binary/tool name:** `disc-server` binary, `disc_*` tool namespace — confirmed.
2. **`disc_read` output format:** Formatted digest (`[timestamp] <author>: <content>` per line) — confirmed.

### 5.A Deliverables Manifest

| ID | Deliverable | Category | Tier | File Path | Produced In | Status | Notes |
|----|-------------|----------|------|-----------|-------------|--------|-------|
| DM-01 | README.md | Docs | 1 | `README.md` | W1 (skeleton), W7 (finalized) | required | Quickstart, tool reference, config, kill switch |
| DM-02 | Unified build system | Code | 1 | `Makefile` | W1 | required | Targets: lint, test, build, ci, e2e |
| DM-03 | CI/CD pipeline | Code | 1 | `.github/workflows/ci.yml`, `.github/workflows/release.yml` | W1 | required | Lint+test on PR; binary build+release on tag |
| DM-04 | Automated test suite | Test | 1 | `tests/` | W2 | required | Unit + integration + E2E |
| DM-05 | Test results (JUnit XML) | Test | 1 | `reports/junit.xml` | W1 | required | CI artifact upload |
| DM-06 | Coverage report | Test | 1 | `reports/coverage.xml` | W1 | required | CI artifact upload |
| DM-07 | CHANGELOG | Docs | 1 | `CHANGELOG.md` | W1 (skeleton), W7 (finalized) | required | Release summary |
| DM-08 | VRTM | Trace | 1 | PRD Appendix V | W7 | required | Requirement traceability matrix |
| DM-09 | Tool reference doc | Docs | 1 | `docs/tool-reference.md` | W7 | required | Full parameter reference for all 6 tools |
| DM-10 | Manual verification procedures | Test | 2 | `docs/manual-verification.md` | W7 | required | Trigger: MV-XX items exist in Section 6.4 |
| DM-11 | Architecture doc | Docs | 2 | N/A — because the full design is captured in Section 5.2 (file layout) and DM-09 (tool reference) | — | n/a | Trigger fired (>2 interacting components); N/A by design |
| DM-12 | Environment prerequisites doc | Docs | 2 | N/A — because prerequisites (bot token, discord.json) are documented in DM-01 (README) and DM-09 (tool reference) | — | n/a | Trigger fired (host/platform requirements); N/A by design |

### 5.B Installation & Deployment

#### Local Installation

1. `make build` → produces `dist/disc-server-<platform>`
2. `cp dist/disc-server-<platform> ~/.local/bin/disc-server`
3. Register in `~/.claude.json` as MCP server `disc-server`
4. `disc-server --version` — verify

#### CI/CD Pipeline

| Stage | Trigger | Steps | Artifacts | Gate |
|-------|---------|-------|-----------|------|
| Validate | Every push | `tsc --noEmit`, `shellcheck` | None | Must pass to merge |
| Test | Every push | `bun test --reporter junit`, coverage | `reports/junit.xml`, `reports/coverage.xml` | Must pass to merge |
| Build | Merge to main | `scripts/ci/build.sh` (3 platforms) | `dist/disc-server-*` | Must succeed |
| Release | Version tag | Attach binaries to GitHub release | Published binaries | Manual tag |

#### Release / Distribution

`scripts/install-remote.sh` — detects platform, downloads binary from GitHub release, installs to `~/.local/bin/disc-server`, registers MCP server in `~/.claude.json`. Referenced from `claudecode-workflow/mcps.json`.

---

## 6. Test Plan

### 6.1 Test Strategy

- **Unit tests** (story-level): per-module, no network calls. Mock `fetch` and filesystem. Bun test runner.
- **Integration tests** (Section 6.2): cross-module boundaries — config resolution chain, kill switch lifecycle, message splitting, MCP routing. Still no live network.
- **E2E tests** (Section 6.3): live Discord API calls against a designated test channel. Gated behind `DISCORD_INTEGRATION_TESTS=1` — skipped in CI by default, run manually before release.
- **Manual verification** (Section 6.4): live session test confirming full stack (binary → MCP registration → skill stub → tool call).

### 6.2 Integration Tests (Automated)

| ID | Boundary | Description | Req IDs |
|----|----------|-------------|---------|
| IT-01 | `config.ts` → filesystem | Token resolves correctly across all three fallback sources | R-11 |
| IT-02 | `config.ts` → filesystem | `discord.json` values override hardcoded defaults; invalid JSON falls back with stderr warning | R-12, R-13 |
| IT-03 | `kill.ts` → filesystem | Kill switch: manual blocks; timed future blocks; expired auto-clears | R-14, R-15, R-16 |
| IT-04 | `send.ts` → `api.ts` | Messages ≤2000 send as single call; >2000 split into numbered parts | R-07 |
| IT-05 | `api.ts` → mock HTTP | 429 engages kill switch; 4xx/5xx returns descriptive error string | R-09, R-10 |
| IT-06 | `index.ts` → all tools | MCP `tools/list` returns 6 schemas; `tools/call` routes to correct handler | R-01–R-06 |

### 6.3 End-to-End Tests (Automated, `DISCORD_INTEGRATION_TESTS=1`)

| ID | Flow | Description | Req IDs |
|----|------|-------------|---------|
| E2E-01 | `disc_send` → `disc_read` | Send timestamped message; read back and verify in results | R-01, R-02 |
| E2E-02 | `disc_resolve` → `disc_send` | Resolve test channel by name; send to resolved ID | R-04, R-01 |
| E2E-03 | `disc_send` with attachment | Send with file; verify response contains attachment URL | R-01, R-08 |
| E2E-04 | Kill switch lifecycle | Create kill file → request dropped; remove file → succeeds | R-14, R-15 |
| E2E-05 | `disc_list` | List channels; verify known channels present | R-03 |
| E2E-06 | `disc_create_thread` → `disc_read` | Create thread; read thread messages | R-06, R-02 |
| E2E-07 | `disc_create_channel` | Create test channel; verify in `disc_list`; cleanup | R-05 |

### 6.4 Manual Verification Procedures

| ID | Procedure | Pass Criteria | Req IDs |
|----|-----------|--------------|---------|
| MV-01 | Install binary, register MCP server, start a Claude Code session, invoke `/disc` skill stub, verify it routes to `disc_send` MCP tool | Tool call appears in session tool list; message delivered to Discord channel | R-17, R-18, R-19 |

---

## 7. Definition of Done

- [ ] All Phase DoD checklists satisfied
- [ ] All automated tests pass (unit + integration + E2E with `DISCORD_INTEGRATION_TESTS=1`) [R-01–R-16]
- [ ] MV-01 executed and passed — live session confirms skill stub routes to MCP tools [R-17, R-18, R-19]
- [ ] All deliverables from the Deliverables Manifest (Section 5.A) produced and verified
- [ ] `disc/SKILL.md` is ≤25 lines with no bash snippets or API call patterns [R-19]
- [ ] Binary installs and registers correctly on Linux x64, macOS arm64, macOS x64 [R-17]
- [ ] Kill switch behavior verified under all three conditions (manual, timed, expired) [R-14, R-15, R-16]

### 7.2 PRD Finalization Checklist

- [ ] Every Tier 1 row in the Deliverables Manifest (5.A) has a file path or "N/A — because [reason]"
- [ ] Every Tier 2 trigger that fires has a corresponding row in the Deliverables Manifest
- [ ] Every Deliverables Manifest row has a "Produced In" wave assignment
- [ ] Every MV-XX in Section 6.4 has a procedure document in the Deliverables Manifest
- [ ] No deliverable is referenced only as a verb without a corresponding noun (file path)
- [ ] At least one audience-facing doc (DM-09) has a file path assigned
- [ ] Section 7 Definition of Done references the Deliverables Manifest (not separate Artifact Manifest + Documentation Kit)

---

## 8. Phased Implementation Plan

### How to read this section

**Phases map to Epics.** Each Phase is a major milestone with its own Definition of Done. **Waves enable parallel development.** Stories in the same Wave have no inter-dependencies and can run simultaneously. **One story, one repo.**

### Wave Map

```
W1 ─── [1.1] Foundation scaffold
          │
W2 ─── [1.2] Shared modules (config, kill, api)
          │
W3 ─┬─ [2.1] disc_send
    ├─ [2.2] disc_read
    └─ [2.3] disc_resolve
          │
W4 ─┬─ [2.4] disc_list
    ├─ [2.5] disc_create_channel
    └─ [2.6] disc_create_thread
          │
W5 ─── [2.7] MCP wiring + IT-06
          │
W6 ─── [3.1] claudecode-workflow integration
          │
W7 ─┬─ [3.2] E2E tests + MV-01
    └─ [3.3] Docs finalization
```

| Wave | Stories | Parallel? |
|------|---------|-----------|
| W1 | 1.1 | Single |
| W2 | 1.2 | Single |
| W3 | 2.1, 2.2, 2.3 | Yes — 3 independent |
| W4 | 2.4, 2.5, 2.6 | Yes — 3 independent |
| W5 | 2.7 | Single |
| W6 | 3.1 | Single |
| W7 | 3.2, 3.3 | Yes — 2 independent |

---

### Phase 1: Foundation (Epic) (#1)

**Goal:** Project scaffolded, CI green, shared modules tested, binary builds successfully.

#### Phase 1 Definition of Done

- [ ] `make ci` passes from a clean checkout [R-17]
- [ ] Binary builds for all 3 platforms [R-17]
- [ ] Config, token, and kill-switch unit + integration tests pass [R-11–R-16]
- [ ] Deliverables Manifest items DM-02, DM-03, DM-05, DM-06 produced

---

#### Story 1.1: Foundation Scaffold (#4)

**Wave:** W1
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** None

Scaffold the project: all tooling, CI/CD, build pipeline, and a stub `index.ts` with placeholder handlers for all 6 tools.

**Implementation Steps:**

1. Create `package.json` — name `mcp-server-discord`, `type: module`. Scripts: `start`, `lint`, `test`, `ci`. Dependencies: `@modelcontextprotocol/sdk`. DevDependencies: `typescript`, `@types/bun`.
2. Create `tsconfig.json` — strict mode, ESNext target, bundler module resolution (mirror `mcp-server-nerf` pattern).
3. Create `Makefile` — targets: `lint` (`bunx tsc --noEmit`), `test` (`bun test`), `build` (`./scripts/ci/build.sh`), `ci` (`./scripts/ci/validate.sh`), `e2e` (`DISCORD_INTEGRATION_TESTS=1 bun test tests/e2e/`).
4. Create `scripts/ci/validate.sh` — runs `tsc --noEmit` then `bun test --reporter junit --coverage`; writes `reports/junit.xml` and `reports/coverage.xml`.
5. Create `scripts/ci/build.sh` — `bun build --compile index.ts` for `bun-linux-x64`, `bun-darwin-arm64`, `bun-darwin-x64`; outputs to `dist/disc-server-<platform>`.
6. Create `.github/workflows/ci.yml` — triggers on push/PR; calls `./scripts/ci/validate.sh`; uploads `reports/` as CI artifacts.
7. Create `.github/workflows/release.yml` — triggers on version tag; calls `build.sh`; attaches 3 binaries to GitHub release.
8. Create `index.ts` — MCP server stub: registers all 6 tool schemas with full parameter definitions, routes each to a placeholder handler returning `"not implemented"`. Server name `disc-server`, version `1.0.0`.
9. Create `tests/smoke.test.ts` — imports tool list from `index.ts`, asserts 6 tools registered with correct names.
10. Create `README.md` skeleton (title, badges, placeholder sections for quickstart, tools, config, kill switch).
11. Create `CHANGELOG.md` skeleton (`## [Unreleased]`).
12. Create `scripts/install-remote.sh` — detects platform (`uname -m` + `uname -s`), downloads binary from GitHub release URL, installs to `~/.local/bin/disc-server`, registers MCP server `disc-server` in `~/.claude.json` (remove existing + add new, mirroring `mcp-server-nerf` install script pattern).

**Test Procedures:**

*Unit Tests:*

| Test Name | Purpose | File |
|-----------|---------|------|
| `smoke — tool count` | Asserts exactly 6 tools registered | `tests/smoke.test.ts` |
| `smoke — tool names` | Asserts correct names: disc_send, disc_read, disc_list, disc_resolve, disc_create_channel, disc_create_thread | `tests/smoke.test.ts` |

*Integration/E2E Coverage:*
- IT-06 — partially covered (tool list verifiable; handlers are stubs until W5)

**Acceptance Criteria:**

- [ ] `make ci` passes [R-17]
- [ ] `make build` produces 3 binaries in `dist/` [R-17]
- [ ] `index.ts` registers exactly 6 tools with correct `disc_*` names [R-01–R-06]
- [ ] Both smoke tests pass [R-01–R-06]
- [ ] `reports/junit.xml` and `reports/coverage.xml` produced by `make ci` [DM-05, DM-06]
- [ ] CI workflow runs and passes on push [DM-03]

---

#### Story 1.2: Shared Modules (#5)

**Wave:** W2
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 1.1

Implement `config.ts`, `kill.ts`, and `api.ts` — the shared infrastructure used by all tool handlers.

**Implementation Steps:**

1. Create `config.ts`:
   - `loadDiscordConfig()` — reads `~/.claude/discord.json`, validates JSON (logs warning + falls back on parse error), caches result in module scope
   - `getConfigValue(jqPath: string, envVar: string, hardcodedDefault: string): string` — 3-step fallback: config file → env var → hardcoded default
   - `getToken(): string` — `DISCORD_BOT_TOKEN` env var → `~/secrets/discord-bot-token` file → throws `"Discord bot token not found"`
   - Export hardcoded defaults as named constants: `DEFAULT_GUILD_ID`, `DEFAULT_CHANNEL_ID`, `DEFAULT_ROLL_CALL_ID`

2. Create `kill.ts`:
   - `KILL_FILE = path.join(os.homedir(), ".claude/discord-bot.kill")`
   - `checkKillSwitch(): { active: boolean; reason: string; expiresAt?: number }` — reads file if present; if no content = manual kill (active); if numeric content = compare to `Date.now()` (active if future, auto-delete file if past)
   - `engageKillSwitch(expiryMs: number): void` — writes `String(Date.now() + expiryMs)` to kill file
   - `killError(state: ReturnType<typeof checkKillSwitch>): string` — returns human-readable error with expiry time if applicable

3. Create `api.ts`:
   - `DISCORD_BASE = "https://discord.com/api/v10"`
   - `discordFetch(path: string, options: RequestInit): Promise<DiscordResult>` where `DiscordResult = { ok: true; data: unknown } | { ok: false; error: string }`
   - Injects `Authorization: Bot <token>` and `Content-Type: application/json` headers (skip Content-Type for multipart)
   - On 429: calls `engageKillSwitch(retryAfterMs)`, returns `{ ok: false, error: "Rate limited. Kill switch engaged until <time>." }`
   - On 4xx/5xx: returns `{ ok: false, error: "HTTP <status>: <body text>" }`
   - On success: returns `{ ok: true, data: <parsed JSON> }`

**Test Procedures:**

*Unit Tests:*

| Test Name | Purpose | File |
|-----------|---------|------|
| `config — json overrides defaults` | discord.json values take precedence over hardcoded | `tests/config.test.ts` |
| `config — invalid json falls back` | Bad JSON → stderr warning + hardcoded defaults returned | `tests/config.test.ts` |
| `config — token from env` | `DISCORD_BOT_TOKEN` env resolves correctly | `tests/config.test.ts` |
| `config — token from file` | File at `~/secrets/discord-bot-token` resolves correctly | `tests/config.test.ts` |
| `config — token missing throws` | Neither env nor file → throws descriptive error | `tests/config.test.ts` |
| `kill — manual kill active` | File with no timestamp → `{ active: true }` | `tests/kill.test.ts` |
| `kill — timed kill active` | File with future timestamp → `{ active: true }` | `tests/kill.test.ts` |
| `kill — expired kill clears` | File with past timestamp → `{ active: false }`, file removed | `tests/kill.test.ts` |
| `api — 429 engages kill switch` | Mock 429 response → kill file written | `tests/api.test.ts` |
| `api — 4xx returns error string` | Mock 404 → `{ ok: false, error: "HTTP 404: ..." }` | `tests/api.test.ts` |

*Integration/E2E Coverage:*
- IT-01, IT-02 — now runnable
- IT-03 — now runnable
- IT-05 — now runnable

**Acceptance Criteria:**

- [ ] All 10 unit tests pass [R-11, R-12, R-13, R-14, R-15, R-16]
- [ ] IT-01, IT-02, IT-03, IT-05 pass [R-11–R-16]
- [ ] `getToken()` throws with message `"Discord bot token not found"` when neither source present [R-11]
- [ ] Kill switch expired file is auto-deleted on `checkKillSwitch()` call [R-16]
- [ ] `api.ts` engages kill switch and returns error on 429 [R-10]

---

### Phase 2: Tool Surface (Epic) (#2)

**Goal:** All 6 `disc_*` tools implemented, tested, and routing correctly end-to-end via MCP.

#### Phase 2 Definition of Done

- [ ] All 6 tools return correct results against mocked HTTP [R-01–R-10]
- [ ] IT-04 and IT-06 pass [R-07, R-01–R-06]
- [ ] All unit tests pass (`make ci` green) [R-01–R-10]

---

#### Story 2.1: disc_send (#6)

**Wave:** W3
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 1.2

**Implementation Steps:**

1. Create `send.ts` — `export async function handleSend(params: Record<string, unknown>): Promise<string>`:
   - Extract `channel_id` (required string), `message` (required string), `embed?` (optional string, format `title:body`), `attach_path?` (optional string)
   - Call `checkKillSwitch()` — return `killError()` if active
   - Split `message` into chunks: `const chunks = splitMessage(message)` where `splitMessage` breaks on last whitespace before 2000 chars; if `chunks.length > 1`, prefix each `(1/${n})`, `(2/${n})`, etc.
   - For each chunk except last: `await discordFetch(`/channels/${channel_id}/messages`, { method: "POST", body: JSON.stringify({ content: chunk }) })`
   - For last chunk: if `attach_path` provided, build `FormData` with `file` field (read file from disk) and `payload_json` field; if `embed` provided, parse `title:body` and add embed object to payload
   - Return `"Sent to channel ${channel_id}"` on success, error string on failure
2. In `index.ts`, replace `disc_send` placeholder: `import { handleSend } from "./send.ts"` and wire in `HANDLERS`.

**Test Procedures:**

*Unit Tests:*

| Test Name | Purpose | File |
|-----------|---------|------|
| `send — single message` | ≤2000 chars → exactly 1 API call | `tests/send.test.ts` |
| `send — split 2-part` | 2001 chars → 2 calls, parts labeled `(1/2)`, `(2/2)` | `tests/send.test.ts` |
| `send — kill active` | Active kill → 0 API calls, error returned | `tests/send.test.ts` |
| `send — embed in last chunk` | Embed param → embed object in final call payload | `tests/send.test.ts` |
| `send — attach path` | attach_path provided → multipart FormData used | `tests/send.test.ts` |

*Integration/E2E Coverage:*
- IT-04 — now runnable
- E2E-01, E2E-02, E2E-03 — runnable after W7

**Acceptance Criteria:**

- [ ] All 5 unit tests pass [R-01, R-07, R-08, R-14]
- [ ] IT-04 passes [R-07]
- [ ] Kill switch checked before any fetch call [R-14, R-15]
- [ ] `disc_send` handler registered in `index.ts` (no longer returns "not implemented") [R-01]

---

#### Story 2.2: disc_read (#7)

**Wave:** W3
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 1.2

**Implementation Steps:**

1. Create `read.ts` — `export async function handleRead(params): Promise<string>`:
   - Extract `channel_id` (required string), `limit` (optional integer, default 20, clamp to max 100)
   - Check kill switch
   - `discordFetch(`/channels/${channel_id}/messages?limit=${limit}`, { method: "GET" })`
   - Format response array: for each message, `[${isoTimestamp}] <${author.username}>: ${content}` (newline-separated, messages in chronological order — API returns newest-first, so reverse)
   - Return formatted digest or error string
2. Wire into `index.ts`.

**Test Procedures:**

*Unit Tests:*

| Test Name | Purpose | File |
|-----------|---------|------|
| `read — formats digest` | Mock response → correct `[ts] <user>: content` format | `tests/read.test.ts` |
| `read — default limit` | No limit param → `limit=20` in request URL | `tests/read.test.ts` |
| `read — clamps limit` | limit=200 → clamped to 100 | `tests/read.test.ts` |
| `read — kill active` | Active kill → error, no API call | `tests/read.test.ts` |

**Acceptance Criteria:**

- [ ] All 4 unit tests pass [R-02, R-14]
- [ ] Output is chronological (oldest first) [R-02]
- [ ] Default limit is 20; maximum is 100 [R-02]
- [ ] Handler wired in `index.ts` [R-02]

---

#### Story 2.3: disc_resolve (#8)

**Wave:** W3
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 1.2

**Implementation Steps:**

1. Create `resolve.ts` — `export async function handleResolve(params): Promise<string>`:
   - Extract `guild_id` (required), `channel_name` (required)
   - Normalize: strip `#` prefix, lowercase
   - Check kill switch
   - `discordFetch(`/guilds/${guild_id}/channels`, { method: "GET" })`
   - Filter channels array: find entry where `channel.name.toLowerCase() === normalizedName`
   - Return `channel.id` on match, `"Channel '#${name}' not found in guild"` on no match
2. Wire into `index.ts`.

**Test Procedures:**

*Unit Tests:*

| Test Name | Purpose | File |
|-----------|---------|------|
| `resolve — match found` | Mock guild channels → returns correct ID | `tests/resolve.test.ts` |
| `resolve — strips hash prefix` | `#agent-ops` matches `agent-ops` entry | `tests/resolve.test.ts` |
| `resolve — case insensitive` | `Agent-Ops` matches `agent-ops` entry | `tests/resolve.test.ts` |
| `resolve — not found` | No match → descriptive error string | `tests/resolve.test.ts` |

**Acceptance Criteria:**

- [ ] All 4 unit tests pass [R-04]
- [ ] Case-insensitive, `#`-stripped matching [R-04]
- [ ] Handler wired in `index.ts` [R-04]

---

#### Story 2.4: disc_list (#9)

**Wave:** W4
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 1.2

**Implementation Steps:**

1. Create `list.ts` — `export async function handleList(params): Promise<string>`:
   - Extract `guild_id` (required), `type` (optional, default `"text"`)
   - Map type to Discord integer: `text=0`, `voice=2`, `category=4`
   - Check kill switch
   - `discordFetch(`/guilds/${guild_id}/channels`, { method: "GET" })`
   - Filter by `channel.type === typeInt`, sort by `channel.position`
   - Format: `#${channel.name} (${channel.id})` per line
   - Return formatted list or error
2. Wire into `index.ts`.

**Test Procedures:**

*Unit Tests:*

| Test Name | Purpose | File |
|-----------|---------|------|
| `list — default type is text` | No type param → only type=0 channels returned | `tests/list.test.ts` |
| `list — filters by voice` | type=voice → only type=2 channels | `tests/list.test.ts` |
| `list — format output` | Each entry `#name (id)` format | `tests/list.test.ts` |
| `list — sorted by position` | Channels returned in position order | `tests/list.test.ts` |

**Acceptance Criteria:**

- [ ] All 4 unit tests pass [R-03]
- [ ] Default type is `text` (Discord type 0) [R-03]
- [ ] Handler wired in `index.ts` [R-03]

---

#### Story 2.5: disc_create_channel (#10)

**Wave:** W4
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 1.2

**Implementation Steps:**

1. Create `create_channel.ts` — `export async function handleCreateChannel(params): Promise<string>`:
   - Extract `guild_id` (required), `name` (required), `topic?`, `category_id?`
   - Sanitize name: strip `#`, replace spaces with `-`, lowercase
   - Check kill switch
   - Build payload: `{ name: sanitized, type: 0, ...(topic && { topic }), ...(category_id && { parent_id: category_id }) }`
   - `discordFetch(`/guilds/${guild_id}/channels`, { method: "POST", body: JSON.stringify(payload) })`
   - Return `"Created #${name} (${channel.id})"` or error
2. Wire into `index.ts`.

**Test Procedures:**

*Unit Tests:*

| Test Name | Purpose | File |
|-----------|---------|------|
| `create_channel — sanitizes name` | Spaces → hyphens, strip `#`, lowercase | `tests/create_channel.test.ts` |
| `create_channel — with topic` | Topic included in POST payload | `tests/create_channel.test.ts` |
| `create_channel — minimal payload` | No topic/category → payload only has name and type | `tests/create_channel.test.ts` |

**Acceptance Criteria:**

- [ ] All 3 unit tests pass [R-05]
- [ ] Name sanitized before API call [R-05]
- [ ] Returns channel ID in confirmation string [R-05]
- [ ] Handler wired in `index.ts` [R-05]

---

#### Story 2.6: disc_create_thread (#11)

**Wave:** W4
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 1.2

**Implementation Steps:**

1. Create `create_thread.ts` — `export async function handleCreateThread(params): Promise<string>`:
   - Extract `channel_id` (required), `name` (required), `auto_archive` (optional, default 1440)
   - Validate `auto_archive` is one of `[60, 1440, 4320, 10080]` — return error string if invalid (no API call)
   - Check kill switch
   - `discordFetch(`/channels/${channel_id}/threads`, { method: "POST", body: JSON.stringify({ name, auto_archive_duration: auto_archive, type: 11 }) })`
   - Return `"Created thread #${name} (${thread.id})"` or error
2. Wire into `index.ts`.

**Test Procedures:**

*Unit Tests:*

| Test Name | Purpose | File |
|-----------|---------|------|
| `create_thread — default archive` | No auto_archive param → 1440 in payload | `tests/create_thread.test.ts` |
| `create_thread — invalid archive` | Invalid duration → error returned before fetch | `tests/create_thread.test.ts` |
| `create_thread — valid durations` | Each valid value (60, 1440, 4320, 10080) accepted | `tests/create_thread.test.ts` |

**Acceptance Criteria:**

- [ ] All 3 unit tests pass [R-06]
- [ ] Invalid `auto_archive` rejected before API call [R-06]
- [ ] Default `auto_archive` is 1440 [R-06]
- [ ] Handler wired in `index.ts` [R-06]

---

#### Story 2.7: MCP Wiring + IT-06 (#12)

**Wave:** W5
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6

Audit that all 6 tool imports are wired in `index.ts`, then implement and run the full routing integration test.

**Implementation Steps:**

1. Audit `index.ts` — confirm all 6 handlers imported from their respective `.ts` files, no placeholder functions remain in `HANDLERS` map.
2. Create `tests/routing.test.ts` — IT-06 integration test:
   - Use `@modelcontextprotocol/sdk` test utilities (or spawn server in-process) to call `tools/list` and assert 6 tools returned
   - Call each tool via `tools/call` with minimal valid params (using mock fetch); assert each handler called and returns a string (not "not implemented")
3. Run `make ci` — all tests must pass with no regressions.

**Test Procedures:**

*Integration/E2E Coverage:*
- IT-06 — now fully runnable

**Acceptance Criteria:**

- [ ] IT-06 passes — `tools/list` returns 6 schemas; all 6 `tools/call` invocations route to real handlers [R-01–R-06]
- [ ] `make ci` green [R-01–R-06]
- [ ] No handler returns `"not implemented"` [R-01–R-06]

---

### Phase 3: Integration & Release (Epic) (#3)

**Goal:** Server integrated into cc-workflow kit, E2E verified against live Discord, documented, released.

#### Phase 3 Definition of Done

- [ ] `disc-server` registered in `claudecode-workflow/mcps.json` [R-18]
- [ ] `disc/SKILL.md` ≤25 lines, no bash snippets [R-19]
- [ ] All E2E tests pass with `DISCORD_INTEGRATION_TESTS=1` [R-01–R-10]
- [ ] MV-01 executed and passed [R-17, R-18, R-19]
- [ ] All Deliverables Manifest rows delivered [DM-01–DM-10]

---

#### Story 3.1: claudecode-workflow Integration (claudecode-workflow#278)

**Wave:** W6
**Repository:** `Wave-Engineering/claudecode-workflow`
**Dependencies:** Story 2.7, `install-remote.sh` available in `mcp-server-discord`

**Implementation Steps:**

1. Add `disc-server` entry to `claudecode-workflow/mcps.json`:
   ```json
   "disc-server": {
     "repo": "Wave-Engineering/mcp-server-discord",
     "install_url": "https://raw.githubusercontent.com/Wave-Engineering/mcp-server-discord/main/scripts/install-remote.sh",
     "description": "Discord send/read/manage for Claude Code agents"
   }
   ```
2. Rewrite `skills/disc/SKILL.md` to ≤25-line stub:
   - Header with name, description, usage (1-line per subcommand)
   - Resolve agent identity from `/tmp/claude-agent-<dir_hash>.json`
   - Resolve channel from args or `~/.claude/discord.json` defaults
   - Route intent to appropriate `disc_*` MCP tool call
   - No bash snippets, no curl examples, no API call patterns
3. Run `./install.sh --check` — verify no unexpected diffs.

**Acceptance Criteria:**

- [ ] `mcps.json` has `disc-server` entry with valid `install_url` [R-18]
- [ ] `disc/SKILL.md` is ≤25 lines and contains zero bash code blocks [R-19]
- [ ] `./install.sh --check` passes cleanly [R-18]

---

#### Story 3.2: E2E Tests + MV-01 (#13)

**Wave:** W7
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 3.1

**Implementation Steps:**

1. Create `tests/e2e/integration.test.ts` — implement E2E-01 through E2E-07 (see Section 6.3), all gated on `process.env.DISCORD_INTEGRATION_TESTS === "1"`.
2. Use a designated test channel (resolve from `~/.claude/discord.json` `channels.test.id` or create one).
3. Add cleanup logic for E2E-07 (delete created channel after test).
4. Run `make e2e` — all 7 tests must pass.
5. Execute MV-01: install `disc-server` binary, register MCP, start a fresh Claude Code session, invoke `/disc` skill, verify `disc_send` tool call appears in session output and message appears in Discord. Record pass/fail + evidence in `docs/manual-verification.md`.

**Acceptance Criteria:**

- [ ] `make e2e` passes all 7 E2E tests [R-01–R-10]
- [ ] MV-01 recorded as passed in `docs/manual-verification.md` [R-17, R-18, R-19]

---

#### Story 3.3: Docs Finalization (#14)

**Wave:** W7
**Repository:** `Wave-Engineering/mcp-server-discord`
**Dependencies:** Story 2.7

**Implementation Steps:**

1. Complete `README.md`: quickstart (3 steps: install, configure token, use `/disc`), all 6 tool signatures with parameter tables and example outputs, config schema (`discord.json` structure), kill switch behavior and manual override instructions.
2. Write `docs/tool-reference.md`: full parameter reference for all 6 tools, return value formats, all error strings, config fallback chain diagram.
3. Update `CHANGELOG.md`: add `## [1.0.0] — YYYY-MM-DD` section with summary of all features.
4. Complete VRTM in PRD Appendix V: fill in all R-01–R-19 rows with verification items and final status.

**Acceptance Criteria:**

- [ ] `README.md` has quickstart, all 6 tool examples, config schema, kill switch docs [DM-01]
- [ ] `docs/tool-reference.md` covers all 6 tools with parameter types, defaults, and return formats [DM-09]
- [ ] `CHANGELOG.md` has `## [1.0.0]` entry [DM-07]
- [ ] VRTM Appendix V has all 19 requirement rows with status [DM-08]

---

## 9. Appendices

### Appendix V: Verification Requirements Traceability Matrix (VRTM)

*Completed 2026-04-06. All requirements verified as of v1.0.0 release.*

| Req ID | Requirement (short) | Verification Item | Method | Status |
|--------|--------------------|--------------------|--------|--------|
| R-01 | disc_send tool | `send.ts` implements `handleSend`; all 5 unit tests in `tests/send.test.ts` pass; IT-06 routes `disc_send` to real handler; E2E-01 confirms live message delivery | Unit + integration + E2E | PASS |
| R-02 | disc_read tool | `read.ts` implements `handleRead`; all 4 unit tests in `tests/read.test.ts` pass; IT-06 routes `disc_read`; E2E-01 confirms read-back of sent message | Unit + integration + E2E | PASS |
| R-03 | disc_list tool | `list.ts` implements `handleList`; unit tests in `tests/list.test.ts` pass; E2E-05 lists known guild channels and verifies expected channels present | Unit + E2E | PASS |
| R-04 | disc_resolve tool | `resolve.ts` implements `handleResolve`; unit tests in `tests/resolve.test.ts` pass; E2E-02 resolves test channel by name and sends to resolved ID | Unit + E2E | PASS |
| R-05 | disc_create_channel | `create_channel.ts` implements `handleCreateChannel`; all 3 unit tests in `tests/create_channel.test.ts` pass; E2E-07 creates channel, verifies in `disc_list`, cleans up | Unit + E2E | PASS |
| R-06 | disc_create_thread | `create_thread.ts` implements `handleCreateThread`; all 3 unit tests in `tests/create_thread.test.ts` pass; E2E-06 creates thread and reads thread messages | Unit + E2E | PASS |
| R-07 | Message auto-split | `send.ts:splitMessage()` splits on last whitespace before 2000 chars; `send — split 2-part` test confirms 2-call behavior and `(1/2)`/`(2/2)` labels; IT-04 validates split boundary | Unit + integration | PASS |
| R-08 | File attachment | `send.ts` uses `FormData` with `files[0]` field when `attach_path` provided; `send — attach path` unit test confirms multipart path; E2E-03 sends file and verifies attachment URL in response | Unit + E2E | PASS |
| R-09 | API error handling | `api.ts:discordFetch()` returns `{ ok: false, error: "HTTP {status}: {body}" }` on 4xx/5xx; `api — 4xx returns error string` test confirms format; IT-05 validates cross-module behavior | Unit + integration | PASS |
| R-10 | 429 kill engagement | `api.ts` calls `engageKillSwitch(Date.now() + 30*60*1000)` on 429; `api — 429 engages kill switch` test confirms kill file written; IT-05 validates; E2E-04 verifies kill lifecycle | Unit + integration + E2E | PASS |
| R-11 | Token fallback chain | `config.ts:getToken()` checks `DISCORD_BOT_TOKEN` env, then `~/secrets/discord-bot-token` file, then throws; all 3 token tests in `tests/config.test.ts` pass; IT-01 validates full chain | Unit + integration | PASS |
| R-12 | discord.json config | `config.ts:loadDiscordConfig()` reads `~/.claude/discord.json` and caches; `getConfigValue()` applies 3-step fallback; `config — json overrides defaults` test confirms precedence; IT-02 validates | Unit + integration | PASS |
| R-13 | Invalid JSON warning | `config.ts` catches JSON parse error, writes warning to stderr, returns `{}`; `config — invalid json falls back` test confirms warning and empty object; IT-02 covers this path | Unit + integration | PASS |
| R-14 | Kill — timed active | `kill.ts:checkKillSwitch()` returns `{ active: true }` when file contains future timestamp; `kill — timed kill active` test confirmed; IT-03 lifecycle test passes; E2E-04 validates | Unit + integration + E2E | PASS |
| R-15 | Kill — manual | `kill.ts:checkKillSwitch()` returns `{ active: true, reason: "manual kill" }` for empty file or non-numeric content; `kill — manual kill active` test confirmed; IT-03 and E2E-04 pass | Unit + integration + E2E | PASS |
| R-16 | Kill — auto-clear | `kill.ts:checkKillSwitch()` calls `unlinkSync(KILL_FILE)` when timestamp is in the past; `kill — expired kill clears` test confirms file removed and `active: false` returned; IT-03 covers this path | Unit + integration | PASS |
| R-17 | 3-platform binary | `scripts/ci/build.sh` builds `disc-server-linux-x64`, `disc-server-darwin-arm64`, `disc-server-darwin-x64` via `bun build --compile`; CI build stage produces all 3 artifacts; MV-01 executed | Build + manual | PASS |
| R-18 | mcps.json registration | `claudecode-workflow/mcps.json` contains `disc-server` entry with `install_url` pointing to `scripts/install-remote.sh`; Story 3.1 AC verified by inspection; MV-01 confirms MCP registration in `~/.claude.json` | Inspection + manual | PASS |
| R-19 | Skill stub ≤25 lines | `skills/disc/SKILL.md` in `claudecode-workflow` is ≤25 lines; contains no bash code blocks or curl patterns; routes all intents to `disc_*` MCP tools; Story 3.1 AC verified by inspection; MV-01 confirms routing in live session | Inspection + manual | PASS |
