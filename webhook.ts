/**
 * Per-agent webhook identity (#55).
 *
 * When webhook identity is enabled, `disc_send` posts each message via a single
 * reused "fleet" webhook per channel, overriding `username` + `avatar_url` per
 * message so each agent shows up as a distinct poster. The text stays in
 * `content`, so other agents read it normally (a webhook message is an ordinary
 * message with a `webhook_id`).
 *
 * Webhook EXECUTE authenticates via the URL token (no bot auth — `skipAuth`).
 * Webhook CREATE/LIST uses the bot token (needs MANAGE_WEBHOOKS) and self-
 * provisions: no manual Discord-UI setup.
 */
import { discordFetch, type DiscordResult } from "./api.ts";

/** Canonical name of the one reused webhook per channel. */
export const FLEET_WEBHOOK_NAME = "cc-fleet";

interface WebhookRef {
  id: string;
  token: string;
}

interface DiscordWebhook {
  id: string;
  name?: string;
  token?: string;
}

// channelId → {id, token}. Reused across sends so we don't hit the
// 10-webhooks/channel cap (per-message username/avatar overrides give
// unlimited identities from one webhook).
const cache = new Map<string, WebhookRef>();

/** For tests: clear the in-memory webhook cache. */
export function _resetWebhookCache(): void {
  cache.clear();
}

/**
 * Get the channel's fleet webhook, creating it if absent. Reuses an existing
 * `cc-fleet` webhook (that still exposes its token) before creating a new one.
 */
export async function getOrCreateWebhook(
  channelId: string
): Promise<DiscordResult<WebhookRef>> {
  const cached = cache.get(channelId);
  if (cached) return { ok: true, data: cached };

  // Reuse an existing fleet webhook if one is present + still exposes its token.
  const list = await discordFetch<DiscordWebhook[]>(`/channels/${channelId}/webhooks`);
  if (list.ok && Array.isArray(list.data)) {
    const existing = list.data.find((w) => w.name === FLEET_WEBHOOK_NAME && w.token);
    if (existing && existing.token) {
      const ref = { id: existing.id, token: existing.token };
      cache.set(channelId, ref);
      return { ok: true, data: ref };
    }
  } else if (!list.ok) {
    return { ok: false, error: `webhook list failed: ${list.error}` };
  }

  // Create one (bot needs MANAGE_WEBHOOKS).
  const created = await discordFetch<DiscordWebhook>(`/channels/${channelId}/webhooks`, {
    method: "POST",
    body: JSON.stringify({ name: FLEET_WEBHOOK_NAME }),
  });
  if (!created.ok) return { ok: false, error: `webhook create failed: ${created.error}` };
  if (!created.data.token) {
    return { ok: false, error: "created webhook has no token" };
  }
  const ref = { id: created.data.id, token: created.data.token };
  cache.set(channelId, ref);
  return { ok: true, data: ref };
}

export interface WebhookExecuteParams {
  username: string;
  avatarUrl?: string;
  content: string;
  embeds?: unknown[];
}

/**
 * Post one message as a given persona via the channel's fleet webhook. Always
 * scopes `allowed_mentions` to nothing by default — webhooks bypass AutoMod, so
 * we never let message text mass-ping (agent `@dev-name` addressing is a text
 * convention the watcher routes on, not a Discord ping). On a stale-webhook
 * 404, the cache is invalidated and the webhook re-provisioned once.
 */
export async function executeWebhook(
  channelId: string,
  params: WebhookExecuteParams
): Promise<DiscordResult<unknown>> {
  const send = async (ref: WebhookRef): Promise<DiscordResult<unknown>> => {
    const body: Record<string, unknown> = {
      username: params.username,
      content: params.content,
      allowed_mentions: { parse: [] },
    };
    if (params.avatarUrl) body.avatar_url = params.avatarUrl;
    if (params.embeds && params.embeds.length > 0) body.embeds = params.embeds;
    return discordFetch(`/webhooks/${ref.id}/${ref.token}?wait=true`, {
      method: "POST",
      body: JSON.stringify(body),
      skipAuth: true,
    });
  };

  const ref = await getOrCreateWebhook(channelId);
  if (!ref.ok) return ref;

  const result = await send(ref.data);
  // Stale webhook (deleted on Discord) → invalidate and re-provision once.
  if (!result.ok && /HTTP 404/.test(result.error)) {
    cache.delete(channelId);
    const fresh = await getOrCreateWebhook(channelId);
    if (!fresh.ok) return fresh;
    return send(fresh.data);
  }
  return result;
}
