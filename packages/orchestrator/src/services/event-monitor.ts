import type {
  Event as OpenCodeEvent,
  PermissionRequest,
  QuestionRequest,
} from "@opencode-ai/sdk/v2";
import type { TaskStatus, WSEvent } from "../types.js";
import * as logger from "../lib/log.js";

type EventCallback = (event: WSEvent) => void;

const subscribers = new Set<EventCallback>();

export function subscribe(cb: EventCallback): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function broadcast(event: WSEvent): void {
  for (const cb of subscribers) {
    try {
      cb(event);
    } catch (err) {
      logger.error("[events]", `Error in event subscriber: ${err}`);
    }
  }
}

export interface StatusChangeEvent {
  status: TaskStatus;
  agentMode?: string;
  permission?: PermissionRequest;
  question?: QuestionRequest;
  error?: string;
}

export async function monitorOpenCodeEvents(
  port: number,
  taskId: string,
  onStatusChange: (event: StatusChangeEvent) => void,
): Promise<AbortController> {
  const controller = new AbortController();
  const url = `http://127.0.0.1:${port}/event`;

  startEventLoop(url, taskId, controller.signal, onStatusChange);

  return controller;
}

function ssePrefix(taskId: string) {
  return `[sse:${taskId.slice(0, 8)}]`;
}

async function startEventLoop(
  url: string,
  taskId: string,
  signal: AbortSignal,
  onStatusChange: (event: StatusChangeEvent) => void,
): Promise<void> {
  let retries = 0;
  const maxRetries = 10;

  while (!signal.aborted && retries < maxRetries) {
    try {
      logger.debug(ssePrefix(taskId), `connecting to ${url}`);
      const response = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      logger.debug(ssePrefix(taskId), "connected");
      retries = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          logger.debug(ssePrefix(taskId), "stream ended");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const block of lines) {
          const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;

          try {
            const raw: unknown = JSON.parse(dataLine.slice(5).trim());
            if (!isOpenCodeEvent(raw)) continue;
            handleSSEEvent(raw, taskId, onStatusChange);
          } catch {
            // Malformed event, skip
          }
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      retries++;
      const backoff = Math.min(1000 * Math.pow(2, Math.min(retries, 5)), 30000);
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        ssePrefix(taskId),
        `connection lost (${msg}), retry ${retries}/${maxRetries} in ${backoff}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  if (retries >= maxRetries) {
    logger.error(ssePrefix(taskId), `gave up after ${maxRetries} retries`);
  }
}

function isOpenCodeEvent(data: unknown): data is OpenCodeEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as Record<string, unknown>).type === "string" &&
    "properties" in data
  );
}

// Track the last-seen agent mode per task so we only emit on change
const lastSeenAgentMode = new Map<string, string>();

export function clearTaskAgentMode(taskId: string): void {
  lastSeenAgentMode.delete(taskId);
}

// SSE events worth logging at info level (status-changing or user-facing)
const SSE_INFO_EVENTS = new Set<OpenCodeEvent["type"]>([
  "session.idle",
  "session.status",
  "session.error",
  "question.asked",
  "question.replied",
  "question.rejected",
  "permission.asked",
  "permission.replied",
]);

function handleSSEEvent(
  data: OpenCodeEvent,
  taskId: string,
  onStatusChange: (event: StatusChangeEvent) => void,
): void {
  const prefix = ssePrefix(taskId);

  if (SSE_INFO_EVENTS.has(data.type)) {
    logger.info(prefix, `event: ${data.type}`);
  } else {
    logger.debug(prefix, `event: ${data.type}`);
  }

  broadcast({ type: "agent:event", taskId, event: data });

  // Agent is asking a question — payload carries the full question
  if (data.type === "question.asked") {
    const q = data.properties;
    logger.info(prefix, `question: ${q.id} (${q.questions.length} sub-questions)`);
    onStatusChange({ status: "needs_input", question: q });
  }

  // Question was answered — agent resumes
  if (data.type === "question.replied") {
    onStatusChange({ status: "agent_running" });
  }

  // Agent is requesting permission — payload carries the full request
  if (data.type === "permission.asked") {
    const props = data.properties;
    logger.info(prefix, `permission requested: ${props.permission} (${props.id})`);
    onStatusChange({ status: "needs_input", permission: props });
  }

  // Permission was replied to — agent should resume
  if (data.type === "permission.replied") {
    onStatusChange({ status: "agent_running" });
  }

  // Session is idle — agent finished its current turn
  if (data.type === "session.idle") {
    logger.info(prefix, `session idle: ${data.properties.sessionID}`);
    onStatusChange({ status: "agent_done" });
  }

  // Session error
  if (data.type === "session.error") {
    const error = data.properties.error;
    let errorMsg: string;
    if (error && "data" in error && "message" in error.data) {
      errorMsg = String(error.data.message);
    } else {
      errorMsg = JSON.stringify(error);
    }
    logger.error(prefix, `session error: ${errorMsg}`);
    onStatusChange({ status: "failed", error: errorMsg });
  }

  // Detect assistant activity — any assistant message means the agent is working
  if (data.type === "message.updated") {
    const info = data.properties.info;
    if (info.role === "assistant") {
      const newMode = info.mode;
      const prevMode = lastSeenAgentMode.get(taskId);
      if (newMode && prevMode !== newMode) {
        lastSeenAgentMode.set(taskId, newMode);
        logger.debug(prefix, `agent mode changed: ${prevMode ?? "unknown"} → ${newMode}`);
      }
      onStatusChange({ status: "agent_running", agentMode: newMode });
    }
  }

  // Forward message updates as logs
  if (data.type === "message.part.updated" || data.type === "message.updated") {
    broadcast({
      type: "task:log",
      taskId,
      message: JSON.stringify(data),
    });
  }
}
