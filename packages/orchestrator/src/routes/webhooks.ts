import { Hono } from "hono";
import type { WebhookConfig } from "../types.js";
import { ALL_WEBHOOK_EVENT_TYPES } from "../types.js";
import {
  getWebhooks,
  addWebhook,
  removeWebhook,
  updateWebhook,
  sendTestEvent,
} from "../services/webhooks.js";

export const webhookRoutes = new Hono();

webhookRoutes.get("/", (c) => {
  const webhooks = getWebhooks().map(sanitizeWebhook);
  return c.json(webhooks);
});

webhookRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    url: string;
    events: string[];
    headers?: Record<string, string>;
    secret?: string;
    active?: boolean;
  }>();

  if (!body.url) {
    return c.json({ error: "url is required" }, 400);
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return c.json({ error: "events[] is required and must not be empty" }, 400);
  }

  const invalidEvents = body.events.filter(
    (e) => !ALL_WEBHOOK_EVENT_TYPES.includes(e as any)
  );
  if (invalidEvents.length > 0) {
    return c.json(
      { error: `Invalid event types: ${invalidEvents.join(", ")}`, validEvents: ALL_WEBHOOK_EVENT_TYPES },
      400
    );
  }

  const webhook: WebhookConfig = {
    id: `whk_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
    url: body.url,
    events: body.events as WebhookConfig["events"],
    active: body.active ?? true,
    headers: body.headers,
    secret: body.secret,
  };

  addWebhook(webhook);

  return c.json(sanitizeWebhook(webhook), 201);
});

webhookRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    url?: string;
    events?: string[];
    headers?: Record<string, string>;
    secret?: string;
    active?: boolean;
  }>();

  if (body.events) {
    const invalidEvents = body.events.filter(
      (e) => !ALL_WEBHOOK_EVENT_TYPES.includes(e as any)
    );
    if (invalidEvents.length > 0) {
      return c.json(
        { error: `Invalid event types: ${invalidEvents.join(", ")}`, validEvents: ALL_WEBHOOK_EVENT_TYPES },
        400
      );
    }
  }

  const updated = updateWebhook(id, body as Partial<Omit<WebhookConfig, "id">>);
  if (!updated) return c.json({ error: "Webhook not found" }, 404);

  return c.json(sanitizeWebhook(updated));
});

webhookRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  const removed = removeWebhook(id);
  if (!removed) return c.json({ error: "Webhook not found" }, 404);
  return c.json({ ok: true });
});

webhookRoutes.post("/:id/test", async (c) => {
  const id = c.req.param("id");
  const webhook = getWebhooks().find((w) => w.id === id);
  if (!webhook) return c.json({ error: "Webhook not found" }, 404);

  const result = await sendTestEvent(webhook);
  return c.json(result);
});

// Don't expose secrets in API responses
function sanitizeWebhook(webhook: WebhookConfig) {
  return {
    ...webhook,
    secret: webhook.secret ? "••••••••" : undefined,
    headers: webhook.headers
      ? Object.fromEntries(
        Object.entries(webhook.headers).map(([k, v]) => {
          const lower = k.toLowerCase();
          if (lower === "authorization" || lower.includes("secret") || lower.includes("token")) {
            return [k, "••••••••"];
          }
          return [k, v];
        })
      )
      : undefined,
  };
}
