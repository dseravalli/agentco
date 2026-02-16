import type { WSEvent, WebhookConfig, WebhookEventType, AlertType } from "../types.js";
import { subscribe } from "./event-monitor.js";
import { getGlobalConfig, saveGlobalConfig } from "./config.js";

let registeredWebhooks: WebhookConfig[] = [];

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 8000]; // delays before retry 2 and 3

// Map AlertType → WebhookEventType
const ALERT_TYPE_MAP: Record<AlertType, WebhookEventType> = {
  needs_question: "alert.needs_input",
  needs_input: "alert.needs_input",
  needs_permission: "alert.needs_permission",
  agent_complete: "alert.agent_complete",
  action_required: "alert.action_required",
  error: "alert.error",
  preview_live: "alert.preview_live",
  pr_created: "alert.pr_created",
};

export function initWebhooks(): void {
  const config = getGlobalConfig();
  registeredWebhooks = config.webhooks ?? [];

  const activeCount = registeredWebhooks.filter((w) => w.active).length;
  console.log(
    `[webhooks] loaded ${registeredWebhooks.length} webhook(s), ${activeCount} active`
  );

  subscribe(handleEvent);
}

export function getWebhooks(): WebhookConfig[] {
  return registeredWebhooks;
}

export function addWebhook(webhook: WebhookConfig): void {
  registeredWebhooks.push(webhook);
  persistWebhooks();
}

export function removeWebhook(id: string): boolean {
  const before = registeredWebhooks.length;
  registeredWebhooks = registeredWebhooks.filter((w) => w.id !== id);
  if (registeredWebhooks.length === before) return false;
  persistWebhooks();
  return true;
}

export function updateWebhook(id: string, updates: Partial<Omit<WebhookConfig, "id">>): WebhookConfig | null {
  const webhook = registeredWebhooks.find((w) => w.id === id);
  if (!webhook) return null;
  Object.assign(webhook, updates);
  persistWebhooks();
  return webhook;
}

function persistWebhooks(): void {
  const config = getGlobalConfig();
  config.webhooks = registeredWebhooks;
  saveGlobalConfig(config);
}

function resolveEventTypes(event: WSEvent): WebhookEventType[] {
  const types: WebhookEventType[] = [];

  if (event.type === "task:status_changed") {
    types.push("task.status_changed");
    if (event.status === "failed") types.push("task.failed");
    if (event.status === "agent_done") types.push("task.completed");
  }

  if (event.type === "task:alert") {
    const mapped = ALERT_TYPE_MAP[event.alert.type];
    if (mapped) types.push(mapped);
  }

  return types;
}

function buildPayload(
  event: WSEvent,
  webhookEventType: WebhookEventType
): Record<string, unknown> {
  const base = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    event: webhookEventType,
  };

  if (event.type === "task:status_changed") {
    return { ...base, data: { taskId: event.taskId, status: event.status } };
  }

  if (event.type === "task:alert") {
    return {
      ...base,
      data: {
        taskId: event.taskId,
        alert: {
          id: event.alert.id,
          type: event.alert.type,
          message: event.alert.message,
          metadata: event.alert.metadata,
          createdAt: event.alert.createdAt,
        },
      },
    };
  }

  return { ...base, data: { taskId: event.taskId } };
}

async function computeSignature(
  body: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function handleEvent(event: WSEvent): void {
  const eventTypes = resolveEventTypes(event);
  if (eventTypes.length === 0) return;

  const activeWebhooks = registeredWebhooks.filter((w) => w.active);
  if (activeWebhooks.length === 0) return;

  for (const webhook of activeWebhooks) {
    // Find the first matching event type for this webhook
    const matchedType = eventTypes.find((t) => webhook.events.includes(t));
    if (!matchedType) continue;

    const payload = buildPayload(event, matchedType);
    deliverWithRetry(webhook, payload);
  }
}

async function deliverWithRetry(
  webhook: WebhookConfig,
  payload: Record<string, unknown>
): Promise<void> {
  const body = JSON.stringify(payload);
  const deliveryId = crypto.randomUUID();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-AgentCo-Event": payload.event as string,
    "X-AgentCo-Delivery": deliveryId,
    ...webhook.headers,
  };

  if (webhook.secret) {
    headers["X-AgentCo-Signature"] = await computeSignature(body, webhook.secret);
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(webhook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        console.log(
          `[webhooks] delivered ${payload.event} to ${webhook.url} (${res.status})`
        );
        return;
      }

      // 4xx errors (except 429) are not retryable
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.error(
          `[webhooks] ${webhook.url} rejected ${payload.event}: ${res.status} ${res.statusText}`
        );
        return;
      }

      console.warn(
        `[webhooks] ${webhook.url} returned ${res.status}, attempt ${attempt}/${MAX_RETRIES}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[webhooks] ${webhook.url} failed: ${msg}, attempt ${attempt}/${MAX_RETRIES}`
      );
    }

    // Wait before retrying (no delay after the last attempt)
    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
    }
  }

  console.error(
    `[webhooks] gave up delivering ${payload.event} to ${webhook.url} after ${MAX_RETRIES} attempts`
  );
}

export async function sendTestEvent(webhook: WebhookConfig): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    event: "test",
    data: { message: "Test webhook delivery from AgentCo" },
  });

  const deliveryId = crypto.randomUUID();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-AgentCo-Event": "test",
    "X-AgentCo-Delivery": deliveryId,
    ...webhook.headers,
  };

  if (webhook.secret) {
    headers["X-AgentCo-Signature"] = await computeSignature(body, webhook.secret);
  }

  try {
    const res = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });

    return { success: res.ok, statusCode: res.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
