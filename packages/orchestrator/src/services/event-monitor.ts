import type { TaskStatus, WSEvent } from "../types.js";
import type { OpenCodeQuestion } from "./opencode.js";
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
  permission?: {
    id: string;
    title: string;
    sessionID: string;
    metadata: Record<string, unknown>;
  };
  question?: OpenCodeQuestion;
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
            const data = JSON.parse(dataLine.slice(5).trim());
            handleSSEEvent(data, taskId, onStatusChange);
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

// Track port per task so we can fetch questions
const taskPorts = new Map<string, number>();

export function setTaskPort(taskId: string, port: number): void {
  taskPorts.set(taskId, port);
}

// Track the last-seen agent mode per task so we only emit on change
const lastSeenAgentMode = new Map<string, string>();

export function clearTaskAgentMode(taskId: string): void {
  lastSeenAgentMode.delete(taskId);
}

// SSE events worth logging at info level (status-changing or user-facing)
const SSE_INFO_EVENTS = new Set([
  "session.idle",
  "session.status",
  "session.error",
  "question.asked",
  "question.replied",
  "question.rejected",
  "permission.updated",
  "permission.replied",
]);

function handleSSEEvent(
  data: Record<string, unknown>,
  taskId: string,
  onStatusChange: (event: StatusChangeEvent) => void,
): void {
  const eventType = data.type as string;
  const prefix = ssePrefix(taskId);

  if (SSE_INFO_EVENTS.has(eventType)) {
    logger.info(prefix, `event: ${eventType}`);
  } else {
    logger.debug(prefix, `event: ${eventType}`);
  }

  broadcast({ type: "agent:event", taskId, event: data });

  // Agent is asking questions (plan mode question tool)
  if (eventType === "question.asked") {
    const port = taskPorts.get(taskId);
    if (port) {
      fetchQuestions(port, taskId, onStatusChange);
    } else {
      logger.warn(prefix, "question.asked but no port registered");
      onStatusChange({ status: "needs_input" });
    }
  }

  // Question was answered — agent resumes
  if (eventType === "question.replied") {
    logger.info(prefix, "question answered, agent resuming");
    onStatusChange({ status: "agent_running" });
  }

  // Agent is requesting permission (tool use, file write, etc.)
  if (eventType === "permission.updated") {
    const props = data.properties as {
      id: string;
      title: string;
      sessionID: string;
      metadata: Record<string, unknown>;
    };
    logger.info(prefix, `permission requested: ${props.title} (${props.id})`);
    onStatusChange({
      status: "needs_input",
      permission: props,
    });
  }

  // Permission was replied to — agent should resume
  if (eventType === "permission.replied") {
    logger.info(prefix, "permission replied, agent resuming");
    onStatusChange({ status: "agent_running" });
  }

  // Session is idle — agent finished its current turn
  if (eventType === "session.idle") {
    const props = data.properties as { sessionID: string };
    logger.info(prefix, `session idle: ${props.sessionID}`);
    onStatusChange({ status: "agent_done" });
  }

  // Session error
  if (eventType === "session.error") {
    const props = data.properties as { error?: { data?: { message?: string } } };
    const errorMsg = props.error?.data?.message ?? JSON.stringify(props.error);
    logger.error(prefix, `session error: ${errorMsg}`);
    onStatusChange({ status: "failed", error: errorMsg });
  }

  // Detect assistant activity — any assistant message means the agent is working
  if (eventType === "message.updated") {
    const props = data.properties as { info?: { role?: string; mode?: string } };
    if (props.info?.role === "assistant") {
      const newMode = props.info.mode;
      const prevMode = lastSeenAgentMode.get(taskId);
      if (newMode && prevMode !== newMode) {
        lastSeenAgentMode.set(taskId, newMode);
        logger.debug(prefix, `agent mode changed: ${prevMode ?? "unknown"} → ${newMode}`);
      }
      onStatusChange({ status: "agent_running", agentMode: newMode });
    }
  }

  // Forward message updates as logs
  if (eventType === "message.part.updated" || eventType === "message.updated") {
    broadcast({
      type: "task:log",
      taskId,
      message: JSON.stringify(data),
    });
  }
}

async function fetchQuestions(
  port: number,
  taskId: string,
  onStatusChange: (event: StatusChangeEvent) => void,
): Promise<void> {
  const prefix = ssePrefix(taskId);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/question`);
    if (!res.ok) {
      logger.warn(prefix, `failed to fetch questions: ${res.status}`);
      onStatusChange({ status: "needs_input" });
      return;
    }
    const questions: OpenCodeQuestion[] = await res.json();
    if (questions.length > 0) {
      const q = questions[0];
      logger.info(prefix, `question: ${q.id} (${q.questions.length} sub-questions)`);
      onStatusChange({ status: "needs_input", question: q });
    } else {
      onStatusChange({ status: "needs_input" });
    }
  } catch (err) {
    logger.warn(prefix, `error fetching questions: ${err}`);
    onStatusChange({ status: "needs_input" });
  }
}
