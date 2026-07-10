/**
 * Agent session identity → Discord webhook persona.
 *
 * CANONICAL RESOLVER — durable-first, fail-closed. This is a faithful mirror of
 * the discord *watcher*'s `resolveIdentity` (mcp-server-discord-watcher
 * `index.ts`), the single source of truth for the fleet's identity contract
 * (#66). Both readers MUST resolve identity identically:
 *   1. read the durable project-local file first,
 *   2. fall back to the legacy `/tmp` file during the transition window,
 *   3. FAIL CLOSED — yield no identity unless BOTH `dev_name` and `dev_team`
 *      are present; a partial/empty file must never shadow a complete identity
 *      in a later location.
 *
 * `/name` writes the identity to `<project_root>/.claude/agent-identity.json`
 * (durable — survives reboots) and, during the transition window, the legacy
 * `/tmp/claude-agent-<md5(project_root)>.json` (emptied on every reboot by
 * systemd-tmpfiles, hence no longer authoritative — the null-at-boot bleed the
 * watcher's #723/#34 work fixed).
 *
 * When webhook identity is enabled, `disc_send` posts each message as that
 * agent's own `username` + `avatar` so a human juggling many concurrent agents
 * can tell them apart at a glance — without moving any text out of `content`
 * (so other agents still read the message normally).
 *
 * DRIFT GUARD: kept behaviorally identical to the watcher on purpose. If you
 * change the resolution rules here, change them there too — or extract the
 * planned shared `@wave-engineering/mcp-identity` module (#66 follow-up, once a
 * third consumer appears). The ported test suite in `identity.test.ts` pins the
 * same behaviors and is the contract that catches drift.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AgentIdentity {
  dev_name: string;
  dev_avatar?: string;
  dev_team: string;
}

/**
 * Resolve the project root — the locked identity-path contract. Claude Code sets
 * `CLAUDE_PROJECT_DIR` in every spawned MCP server's environment to the session
 * project root; it is authoritative and immune to cwd drift. Fall back to
 * `process.cwd()` only if it is somehow unset.
 *
 * We deliberately do NOT use `git rev-parse --show-toplevel` (the watcher
 * dropped it too): it returns the WRONG toplevel whenever the process cwd sits
 * inside an unrelated git repo — the nested-repo hazard (watcher #34).
 */
function projectRoot(): string {
  return process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
}

/**
 * Path to the legacy `/tmp` identity file for a project root, keyed by md5 of
 * the root (the key the `/name` skill used before the durable path existed).
 * `tmpdir()` resolves to `/tmp` on Linux — the same file the watcher reads.
 */
export function identityFilePath(root: string = projectRoot()): string {
  const hash = createHash("md5").update(root).digest("hex");
  return join(tmpdir(), `claude-agent-${hash}.json`);
}

/**
 * Read the current session's agent identity, or `null` if none is fully
 * established. Durable-first, fail-closed (see file header): tries the durable
 * project-local file, then the legacy `/tmp` file; returns an identity only when
 * BOTH `dev_name` and `dev_team` are present; a partial/empty/malformed file
 * falls through to the next location rather than shadowing it. Callers fall back
 * to the default bot identity when this returns `null`.
 *
 * @param root  Project root to resolve against (defaults to the locked
 *              `CLAUDE_PROJECT_DIR` contract). Exposed for tests.
 */
export function readAgentIdentity(root: string = projectRoot()): AgentIdentity | null {
  const durableFile = join(root, ".claude", "agent-identity.json");
  const legacyTmpFile = identityFilePath(root);

  for (const file of [durableFile, legacyTmpFile]) {
    try {
      const obj = JSON.parse(readFileSync(file, "utf8")) as Partial<AgentIdentity>;
      const devName = typeof obj.dev_name === "string" ? obj.dev_name : "";
      const devTeam = typeof obj.dev_team === "string" ? obj.dev_team : "";
      // Fail closed: require BOTH fields. Deaf > over-broad — a partial identity
      // can still match over-broad routing downstream. Fall through otherwise,
      // so an empty/half-written file cannot shadow a complete one below it.
      if (devName && devTeam) {
        return {
          dev_name: devName,
          dev_team: devTeam,
          dev_avatar: typeof obj.dev_avatar === "string" ? obj.dev_avatar : undefined,
        };
      }
    } catch {
      // missing / unreadable / malformed → try the next location
    }
  }
  return null;
}

/**
 * Webhook `username` for an identity. Discord bans the substrings `clyde` and
 * `discord` (case-insensitive) in webhook usernames, and caps at 80 chars.
 * Surrogate sanitization is applied by the caller (shared with `disc_send`).
 *
 * Takes only the persona fields — the webhook name is `dev_name` (+ optional
 * `dev_avatar`); `dev_team` is not part of the visible persona.
 */
export function webhookUsername(id: { dev_name: string; dev_avatar?: string }): string {
  let name = (id.dev_avatar ? `${id.dev_name} ${id.dev_avatar}` : id.dev_name).trim();
  // Discord rejects webhook usernames containing "clyde" or "discord" — neutralize
  // the banned substrings without dropping characters (keeps the name recognizable).
  name = name.replace(/clyde/gi, "clyba").replace(/discord/gi, "disc0rd");
  if (name.length > 80) name = name.slice(0, 80).trim();
  return name;
}

/**
 * Deterministic avatar URL for an agent: a stable, colorful icon seeded by the
 * dev-name (DiceBear, no hosting needed). Same agent → same avatar forever.
 * The style is overridable via ~/.claude/discord.json `webhook_avatar_style`.
 */
export function webhookAvatarUrl(devName: string, style = "bottts"): string {
  const seed = encodeURIComponent(devName);
  return `https://api.dicebear.com/9.x/${style}/png?seed=${seed}`;
}
