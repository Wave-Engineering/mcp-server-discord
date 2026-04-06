/**
 * kill.ts — Kill switch infrastructure for the disc MCP server.
 *
 * Provides:
 *  - KILL_FILE          — path to the kill-switch file
 *  - checkKillSwitch()  — returns { active, reason, expiresAt? }
 *  - engageKillSwitch() — writes an expiry timestamp to the kill file
 *  - killError()        — human-readable error string from kill state
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const KILL_FILE = join(homedir(), ".claude", "discord-bot.kill");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KillState {
  active: boolean;
  reason: string;
  expiresAt?: number;
}

// ---------------------------------------------------------------------------
// checkKillSwitch
// ---------------------------------------------------------------------------

/**
 * Inspect the kill-switch file and return the current state.
 *
 * - File absent          → { active: false, reason: "" }
 * - File with no content → { active: true, reason: "manual kill" }
 * - File with future ms  → { active: true, reason: "timed kill", expiresAt }
 * - File with past ms    → auto-delete file, { active: false, reason: "" }
 */
export function checkKillSwitch(): KillState {
  if (!existsSync(KILL_FILE)) {
    return { active: false, reason: "" };
  }

  const content = readFileSync(KILL_FILE, "utf-8").trim();

  if (content === "") {
    return { active: true, reason: "manual kill" };
  }

  const expiresAt = parseInt(content, 10);

  if (isNaN(expiresAt)) {
    // Non-numeric content — treat as manual kill
    return { active: true, reason: "manual kill" };
  }

  if (expiresAt <= Date.now()) {
    // Expiry has passed — auto-delete and report inactive
    try {
      unlinkSync(KILL_FILE);
    } catch {
      // Ignore deletion errors (race condition, already deleted)
    }
    return { active: false, reason: "" };
  }

  return { active: true, reason: "timed kill", expiresAt };
}

// ---------------------------------------------------------------------------
// engageKillSwitch
// ---------------------------------------------------------------------------

/**
 * Engage the kill switch.
 *
 * @param expiryMs  Absolute Unix timestamp (ms) when the kill switch should
 *                  expire.  Pass 0 or omit for a manual (indefinite) kill.
 */
export function engageKillSwitch(expiryMs?: number): void {
  const content =
    expiryMs !== undefined && expiryMs > 0 ? String(expiryMs) : "";
  writeFileSync(KILL_FILE, content, "utf-8");
}

// ---------------------------------------------------------------------------
// killError
// ---------------------------------------------------------------------------

/**
 * Return a human-readable error message from a KillState.
 */
export function killError(state: KillState): string {
  if (!state.active) {
    return "Kill switch is not active";
  }

  if (state.expiresAt !== undefined) {
    const expiryDate = new Date(state.expiresAt).toISOString();
    return `Kill switch is active (expires at ${expiryDate})`;
  }

  return "Kill switch is active (manual — no expiry)";
}
