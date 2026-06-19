/**
 * Tests for webhook.ts (#55) — per-agent webhook identity lifecycle.
 * Mocks globalThis.fetch (the repo convention); no real network.
 */
import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { _resetRoutingState, redactWebhookToken } from "../api.ts";
import {
  getOrCreateWebhook,
  executeWebhook,
  _resetWebhookCache,
  FLEET_WEBHOOK_NAME,
} from "../webhook.ts";

const CH = "100";
const WH = { id: "wh1", token: "tok1" };

let originalFetch: typeof fetch;
let savedToken: string | undefined;
let calls: Array<{ url: string; method: string; headers: Headers; body: string }>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Record every fetch and dispatch by URL/method; `execMode` controls the execute response. */
function installFetch(opts: {
  list?: unknown[]; // GET /channels/{id}/webhooks
  execStatus?: number[]; // sequence of execute statuses (e.g. [404, 200])
}) {
  const execStatuses = [...(opts.execStatus ?? [200])];
  globalThis.fetch = mock(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({
        url,
        method,
        headers: new Headers(init?.headers as HeadersInit | undefined),
        body: typeof init?.body === "string" ? init.body : "",
      });
      // Webhook EXECUTE: /webhooks/{id}/{token}
      if (/\/webhooks\/[^/]+\/[^/?]+/.test(url) && method === "POST") {
        const st = execStatuses.shift() ?? 200;
        return json(st === 200 ? { id: "msg1" } : { message: "Unknown Webhook" }, st);
      }
      // Webhook LIST: GET /channels/{id}/webhooks
      if (/\/channels\/[^/]+\/webhooks$/.test(url) && method === "GET") {
        return json(opts.list ?? []);
      }
      // Webhook CREATE: POST /channels/{id}/webhooks
      if (/\/channels\/[^/]+\/webhooks$/.test(url) && method === "POST") {
        return json({ id: WH.id, name: FLEET_WEBHOOK_NAME, token: WH.token });
      }
      // Anything else (e.g. scream-hole health check) → unhealthy → falls to direct.
      return new Response("nope", { status: 503 });
    }
  ) as unknown as typeof fetch;
}

describe("webhook.ts", () => {
  beforeEach(() => {
    savedToken = process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_BOT_TOKEN = "test-bot-token";
    originalFetch = globalThis.fetch;
    calls = [];
    _resetWebhookCache();
    _resetRoutingState();
  });

  afterEach(() => {
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
    globalThis.fetch = originalFetch;
  });

  test("getOrCreateWebhook creates one when none exists", async () => {
    installFetch({ list: [] });
    const r = await getOrCreateWebhook(CH);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual(WH);
    // a POST to create was made
    expect(calls.some((c) => /\/channels\/.+\/webhooks$/.test(c.url) && c.method === "POST")).toBe(true);
  });

  test("getOrCreateWebhook reuses an existing cc-fleet webhook (no create)", async () => {
    installFetch({ list: [{ id: "existing", name: FLEET_WEBHOOK_NAME, token: "extok" }] });
    const r = await getOrCreateWebhook(CH);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ id: "existing", token: "extok" });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  test("getOrCreateWebhook caches (second call makes no requests)", async () => {
    installFetch({ list: [] });
    await getOrCreateWebhook(CH);
    const before = calls.length;
    await getOrCreateWebhook(CH);
    expect(calls.length).toBe(before);
  });

  test("executeWebhook posts to the webhook URL with persona, scoped mentions, NO bot auth", async () => {
    installFetch({ list: [] });
    const r = await executeWebhook(CH, {
      username: "babelfish 🐠",
      avatarUrl: "https://example/a.png",
      content: "hello",
    });
    expect(r.ok).toBe(true);
    const exec = calls.find((c) => /\/webhooks\/[^/]+\/[^/?]+/.test(c.url) && c.method === "POST")!;
    expect(exec).toBeDefined();
    expect(exec.url).toContain("wait=true");
    // skipAuth: webhook execute must NOT carry a bot Authorization header
    expect(exec.headers.has("Authorization")).toBe(false);
    const body = JSON.parse(exec.body);
    expect(body.username).toBe("babelfish 🐠");
    expect(body.avatar_url).toBe("https://example/a.png");
    expect(body.content).toBe("hello");
    expect(body.allowed_mentions).toEqual({ parse: [] });
  });

  test("executeWebhook re-provisions and retries on a stale-webhook 404", async () => {
    installFetch({ list: [], execStatus: [404, 200] });
    const r = await executeWebhook(CH, { username: "x", content: "y" });
    expect(r.ok).toBe(true);
    // two execute attempts (404 then 200)
    const execs = calls.filter((c) => /\/webhooks\/[^/]+\/[^/?]+/.test(c.url) && c.method === "POST");
    expect(execs.length).toBe(2);
  });

  test("redactWebhookToken strips the secret token from a webhook path (no log leak)", () => {
    expect(redactWebhookToken("/webhooks/123/secrettok?wait=true")).toBe("/webhooks/123/***?wait=true");
    // non-webhook paths are unchanged
    expect(redactWebhookToken("/channels/9/messages")).toBe("/channels/9/messages");
  });
});
