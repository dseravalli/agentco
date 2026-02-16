import { eq } from "drizzle-orm";
import type { WSEvent, OpenClawConfig, AlertType, TaskStatus, WebhookEventType } from "../types.js";
import { subscribe } from "./event-monitor.js";
import { getGlobalConfig } from "./config.js";
import { findTask, schema, type Task } from "../db/index.js";

let config: OpenClawConfig | null = null;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 8000];

// Map AlertType → WebhookEventType for filtering
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

const STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  setting_up: "setting up",
  agent_running: "agent is running",
  needs_input: "needs input",
  plan_ready: "plan is ready for review",
  agent_done: "agent finished",
  preview_live: "dev preview is live",
  pr_created: "PR created",
  merged: "merged",
  archived: "archived",
  failed: "failed",
  aborted: "aborted",
};

export function initOpenClaw(): void {
  const globalConfig = getGlobalConfig();
  config = globalConfig.openclaw ?? null;

  if (!config) {
    console.log("[openclaw] no config found, skipping");
    return;
  }

  if (!config.baseUrl || !config.token) {
    console.warn("[openclaw] config missing baseUrl or token, skipping");
    config = null;
    return;
  }

  console.log(`[openclaw] initialized → ${config.baseUrl}`);
  subscribe(handleEvent);
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

function isEventAllowed(eventTypes: WebhookEventType[]): boolean {
  if (!config?.events || config.events.length === 0) return true;
  return eventTypes.some((t) => config!.events!.includes(t));
}

function handleEvent(event: WSEvent): void {
  if (!config) return;

  const eventTypes = resolveEventTypes(event);
  if (eventTypes.length === 0) return;
  if (!isEventAllowed(eventTypes)) return;

  const taskId = "taskId" in event ? event.taskId : null;
  const task = taskId ? findTask(eq(schema.tasks.id, taskId)) ?? null : null;

  const text = buildWakeText(event, task);

  // TODO: Route specific events to /hooks/agent instead of /hooks/wake
  // when the mapping is decided. For now everything goes to /hooks/wake.
  sendWake(text);
}

function buildWakeText(event: WSEvent, task: Task | null): string {
  const taskId = "taskId" in event ? event.taskId : "";
  const taskLabel = task ? `"${task.title}"` : taskId.slice(0, 8);

  if (event.type === "task:status_changed") {
    const label = STATUS_LABELS[event.status] ?? event.status;
    return `Task ${taskLabel}: ${label}`;
  }

  if (event.type === "task:alert") {
    return `Task ${taskLabel}: ${event.alert.message}`;
  }

  return `Task ${taskLabel}: event ${event.type}`;
}

// POST /hooks/wake
async function sendWake(text: string, mode: "now" | "next-heartbeat" = "now"): Promise<void> {
  if (!config) return;

  const url = `${config.baseUrl.replace(/\/+$/, "")}/hooks/wake`;
  const body = JSON.stringify({ text, mode });

  await deliverWithRetry(url, body, `wake: ${text.slice(0, 60)}`);
}

// POST /hooks/agent — available for future routing
export async function sendAgent(opts: {
  message: string;
  name?: string;
  agentId?: string;
  sessionKey?: string;
  wakeMode?: "now" | "next-heartbeat";
  deliver?: boolean;
  channel?: string;
  to?: string;
  model?: string;
  thinking?: string;
  timeoutSeconds?: number;
}): Promise<void> {
  if (!config) return;

  const url = `${config.baseUrl.replace(/\/+$/, "")}/hooks/agent`;
  const payload: Record<string, unknown> = { message: opts.message };

  if (opts.name !== undefined) payload.name = opts.name;
  if (opts.agentId !== undefined) payload.agentId = opts.agentId;
  if (opts.sessionKey !== undefined) payload.sessionKey = opts.sessionKey;
  if (opts.wakeMode !== undefined) payload.wakeMode = opts.wakeMode;
  if (opts.deliver !== undefined) payload.deliver = opts.deliver;
  if (opts.channel !== undefined) payload.channel = opts.channel;
  if (opts.to !== undefined) payload.to = opts.to;
  if (opts.model !== undefined) payload.model = opts.model;
  if (opts.thinking !== undefined) payload.thinking = opts.thinking;
  if (opts.timeoutSeconds !== undefined) payload.timeoutSeconds = opts.timeoutSeconds;

  const body = JSON.stringify(payload);
  await deliverWithRetry(url, body, `agent: ${opts.message.slice(0, 60)}`);
}

async function deliverWithRetry(url: string, body: string, label: string): Promise<void> {
  if (!config) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${config.token}`,
  };

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        console.log(`[openclaw] delivered ${label} (${res.status})`);
        return;
      }

      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.error(`[openclaw] rejected ${label}: ${res.status} ${res.statusText}`);
        return;
      }

      console.warn(`[openclaw] ${label}: ${res.status}, attempt ${attempt}/${MAX_RETRIES}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[openclaw] ${label} failed: ${msg}, attempt ${attempt}/${MAX_RETRIES}`);
    }

    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt - 1]));
    }
  }

  console.error(`[openclaw] gave up delivering ${label} after ${MAX_RETRIES} attempts`);
}
