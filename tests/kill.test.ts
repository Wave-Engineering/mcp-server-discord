/**
 * Unit tests for kill.ts
 *
 * Uses real temp files — no filesystem mocking.
 *
 * Tests cover:
 *  - Manual kill (no-timestamp file) → { active: true }
 *  - Timed kill (future timestamp) → { active: true, expiresAt }
 *  - Expired kill (past timestamp) → { active: false }, file removed
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { KILL_FILE, checkKillSwitch, engageKillSwitch, killError } from "../kill.ts";

// Ensure the .claude directory exists before tests run
const claudeDir = join(homedir(), ".claude");

function removeKillFile(): void {
  try {
    if (existsSync(KILL_FILE)) {
      require("node:fs").unlinkSync(KILL_FILE);
    }
  } catch {
    // ignore
  }
}

describe("kill switch", () => {
  beforeEach(() => {
    mkdirSync(claudeDir, { recursive: true });
    removeKillFile();
  });

  afterEach(() => {
    removeKillFile();
  });

  test("no kill file → inactive", () => {
    const state = checkKillSwitch();
    expect(state.active).toBe(false);
  });

  test("manual kill active (empty file)", () => {
    writeFileSync(KILL_FILE, "", "utf-8");

    const state = checkKillSwitch();
    expect(state.active).toBe(true);
    expect(state.reason).toBe("manual kill");
    expect(state.expiresAt).toBeUndefined();
  });

  test("timed kill active (future timestamp)", () => {
    const futureMs = Date.now() + 60_000; // 1 minute from now
    writeFileSync(KILL_FILE, String(futureMs), "utf-8");

    const state = checkKillSwitch();
    expect(state.active).toBe(true);
    expect(state.reason).toBe("timed kill");
    expect(state.expiresAt).toBe(futureMs);
  });

  test("expired kill clears — file removed", () => {
    const pastMs = Date.now() - 1000; // 1 second ago
    writeFileSync(KILL_FILE, String(pastMs), "utf-8");

    const state = checkKillSwitch();
    expect(state.active).toBe(false);
    expect(existsSync(KILL_FILE)).toBe(false);
  });

  test("engageKillSwitch writes timestamp", () => {
    const expiryMs = Date.now() + 30 * 60 * 1000;
    engageKillSwitch(expiryMs);

    expect(existsSync(KILL_FILE)).toBe(true);
    const state = checkKillSwitch();
    expect(state.active).toBe(true);
    expect(state.expiresAt).toBe(expiryMs);
  });

  test("killError includes expiry time for timed kill", () => {
    const futureMs = Date.now() + 60_000;
    const state = { active: true, reason: "timed kill", expiresAt: futureMs };

    const msg = killError(state);
    expect(msg).toContain("expires at");
    expect(msg).toContain(new Date(futureMs).toISOString());
  });

  test("killError describes manual kill", () => {
    const state = { active: true, reason: "manual kill" };
    const msg = killError(state);
    expect(msg).toContain("manual");
  });
});
