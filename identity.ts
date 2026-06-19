/**
 * Agent session identity → Discord webhook persona.
 *
 * The `/name` skill writes a per-project identity to
 * `/tmp/claude-agent-<md5(project_root)>.json` (`{ dev_name, dev_avatar, dev_team }`).
 * When webhook identity is enabled, `disc_send` posts each message as that
 * agent's own `username` + `avatar` so a human juggling many concurrent agents
 * can tell them apart at a glance — without moving any text out of `content`
 * (so other agents still read the message normally).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface AgentIdentity {
  dev_name: string;
  dev_avatar?: string;
  dev_team?: string;
}

/** Resolve the project root (git toplevel, else cwd) — same key the /name skill uses. */
function projectRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.cwd();
  }
}

/** Path to the identity file for the current project, keyed by md5 of the project root. */
export function identityFilePath(root: string = projectRoot()): string {
  const hash = createHash("md5").update(root).digest("hex");
  return join(tmpdir(), `claude-agent-${hash}.json`);
}

/**
 * Read the current session's agent identity, or null if none is established
 * (no `/name` has run, or the file is missing/malformed). Callers fall back to
 * the default bot identity when this returns null.
 */
export function readAgentIdentity(): AgentIdentity | null {
  try {
    const raw = readFileSync(identityFilePath(), "utf8");
    const obj = JSON.parse(raw) as Partial<AgentIdentity>;
    if (typeof obj.dev_name === "string" && obj.dev_name.length > 0) {
      return {
        dev_name: obj.dev_name,
        dev_avatar: typeof obj.dev_avatar === "string" ? obj.dev_avatar : undefined,
        dev_team: typeof obj.dev_team === "string" ? obj.dev_team : undefined,
      };
    }
  } catch {
    // missing / unreadable / malformed → no identity
  }
  return null;
}

/**
 * Webhook `username` for an identity. Discord bans the substrings `clyde` and
 * `discord` (case-insensitive) in webhook usernames, and caps at 80 chars.
 * Surrogate sanitization is applied by the caller (shared with `disc_send`).
 */
export function webhookUsername(id: AgentIdentity): string {
  let name = id.dev_avatar ? `${id.dev_name} ${id.dev_avatar}` : id.dev_name;
  // Discord rejects webhook usernames containing "clyde" or "discord" — neutralize
  // the banned substrings without dropping characters (keeps the name recognizable).
  name = name.replace(/clyde/gi, "clyba").replace(/discord/gi, "disc0rd");
  if (name.length > 80) name = name.slice(0, 80);
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
