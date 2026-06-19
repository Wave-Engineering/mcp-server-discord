import { describe, test, expect } from "bun:test";
import {
  webhookUsername,
  webhookAvatarUrl,
  identityFilePath,
} from "./identity.ts";
import { createHash } from "node:crypto";

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
