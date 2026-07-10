import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  webhookUsername,
  webhookAvatarUrl,
  identityFilePath,
  readAgentIdentity,
} from "./identity.ts";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("webhookUsername", () => {
  test("combines dev_name + dev_avatar", () => {
    expect(webhookUsername({ dev_name: "babelfish", dev_avatar: "🐠" })).toBe("babelfish 🐠");
  });

  test("falls back to dev_name when no avatar", () => {
    expect(webhookUsername({ dev_name: "neuron" })).toBe("neuron");
  });

  test("neutralizes the banned 'discord' substring (Discord rejects it)", () => {
    const out = webhookUsername({ dev_name: "discord-bot" });
    expect(out.toLowerCase()).not.toContain("discord");
    // and it must not be a no-op
    expect(out).not.toBe("discord-bot");
  });

  test("neutralizes the banned 'clyde' substring", () => {
    const out = webhookUsername({ dev_name: "clyde-jr" });
    expect(out.toLowerCase()).not.toContain("clyde");
  });

  test("caps at 80 characters", () => {
    const long = "x".repeat(200);
    expect(webhookUsername({ dev_name: long }).length).toBe(80);
  });

  test("trims surrounding whitespace", () => {
    expect(webhookUsername({ dev_name: "  spacey  " })).toBe("spacey");
  });

  test("a whitespace-only name reduces to empty (send.ts then falls back to bot path)", () => {
    expect(webhookUsername({ dev_name: "   " })).toBe("");
  });
});

describe("webhookAvatarUrl", () => {
  test("is deterministic for a given dev-name", () => {
    expect(webhookAvatarUrl("babelfish")).toBe(webhookAvatarUrl("babelfish"));
  });

  test("differs by dev-name", () => {
    expect(webhookAvatarUrl("babelfish")).not.toBe(webhookAvatarUrl("neuron"));
  });

  test("url-encodes the seed", () => {
    expect(webhookAvatarUrl("a b")).toContain("seed=a%20b");
  });

  test("honors a custom style", () => {
    expect(webhookAvatarUrl("x", "identicon")).toContain("/9.x/identicon/");
  });
});

describe("identityFilePath", () => {
  test("keys by md5 of the project root (matches the /name skill)", () => {
    const root = "/home/bakerb/sandbox/github/mcp-server-discord";
    const hash = createHash("md5").update(root).digest("hex");
    expect(identityFilePath(root)).toContain(`claude-agent-${hash}.json`);
  });
});

// --- readAgentIdentity: durable-first, fail-closed (#66) ---------------------
//
// Faithful mirror of the watcher's resolveIdentity contract
// (mcp-server-discord-watcher tests/index.test.ts "identity durable-path
// resolution"). This suite IS the drift guard — the two resolvers must behave
// identically. Behavioral fs tests: point CLAUDE_PROJECT_DIR at a scratch root,
// write real identity files, and assert readAgentIdentity's actual return.
describe("readAgentIdentity — durable-path resolution + fail-closed", () => {
  let tmpRoot: string;
  let legacyTmpFile: string;
  const savedProjectDir = process.env.CLAUDE_PROJECT_DIR;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "disc-ident-"));
    process.env.CLAUDE_PROJECT_DIR = tmpRoot;
    // readAgentIdentity keys the legacy file on md5(projectRoot) under tmpdir().
    const dirHash = createHash("md5").update(tmpRoot).digest("hex");
    legacyTmpFile = join(tmpdir(), `claude-agent-${dirHash}.json`);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    if (existsSync(legacyTmpFile)) rmSync(legacyTmpFile, { force: true });
    if (savedProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = savedProjectDir;
  });

  function writeDurable(obj: unknown): void {
    mkdirSync(join(tmpRoot, ".claude"), { recursive: true });
    writeFileSync(join(tmpRoot, ".claude", "agent-identity.json"), JSON.stringify(obj));
  }
  function writeLegacy(obj: unknown): void {
    writeFileSync(legacyTmpFile, JSON.stringify(obj));
  }

  test("anchors on CLAUDE_PROJECT_DIR and reads the durable .claude/agent-identity.json under it", () => {
    writeDurable({ dev_name: "polyjuice", dev_team: "oaw", dev_avatar: "🧪" });
    expect(readAgentIdentity()).toEqual({ dev_name: "polyjuice", dev_team: "oaw", dev_avatar: "🧪" });
  });

  test("dev_avatar is optional — resolves without it", () => {
    writeDurable({ dev_name: "polyjuice", dev_team: "oaw" });
    expect(readAgentIdentity()).toEqual({ dev_name: "polyjuice", dev_team: "oaw", dev_avatar: undefined });
  });

  test("durable present and valid → legacy /tmp is ignored", () => {
    writeDurable({ dev_name: "polyjuice", dev_team: "oaw" });
    writeLegacy({ dev_name: "STALE", dev_team: "STALE" });
    expect(readAgentIdentity()?.dev_name).toBe("polyjuice");
  });

  test("empty {} durable file does NOT shadow a valid /tmp identity (no-shadow)", () => {
    writeDurable({}); // parses, but yields no usable fields
    writeLegacy({ dev_name: "polyjuice", dev_team: "oaw" });
    expect(readAgentIdentity()?.dev_name).toBe("polyjuice");
  });

  test("partial durable file (missing dev_team) falls through to a complete /tmp identity", () => {
    writeDurable({ dev_name: "polyjuice" }); // incomplete — must not be accepted
    writeLegacy({ dev_name: "polyjuice", dev_team: "oaw" });
    expect(readAgentIdentity()).toEqual({ dev_name: "polyjuice", dev_team: "oaw", dev_avatar: undefined });
  });

  test("FAIL CLOSED: dev_team missing everywhere → null (not a partial identity)", () => {
    writeDurable({ dev_name: "polyjuice" });
    expect(readAgentIdentity()).toBeNull();
  });

  test("FAIL CLOSED: dev_name missing → null", () => {
    writeDurable({ dev_team: "oaw" });
    expect(readAgentIdentity()).toBeNull();
  });

  test("FAIL CLOSED: empty-string fields → null", () => {
    writeDurable({ dev_name: "", dev_team: "oaw" });
    expect(readAgentIdentity()).toBeNull();
  });

  test("neither file present → null", () => {
    expect(readAgentIdentity()).toBeNull();
  });

  test("malformed JSON in durable file falls through to a valid /tmp identity", () => {
    mkdirSync(join(tmpRoot, ".claude"), { recursive: true });
    writeFileSync(join(tmpRoot, ".claude", "agent-identity.json"), "{ not json");
    writeLegacy({ dev_name: "polyjuice", dev_team: "oaw" });
    expect(readAgentIdentity()?.dev_name).toBe("polyjuice");
  });

  test("accepts an explicit root argument (bypasses CLAUDE_PROJECT_DIR)", () => {
    const other = mkdtempSync(join(tmpdir(), "disc-ident-explicit-"));
    try {
      mkdirSync(join(other, ".claude"), { recursive: true });
      writeFileSync(join(other, ".claude", "agent-identity.json"), JSON.stringify({ dev_name: "neuron", dev_team: "oaw" }));
      expect(readAgentIdentity(other)?.dev_name).toBe("neuron");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});
