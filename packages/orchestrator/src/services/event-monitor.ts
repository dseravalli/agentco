import type { TaskStatus, WSEvent } from "../types.js";
import type { OpenCodeQuestion } from "./opencode.js";

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
      console.error("Error in event subscriber:", err);
    }
  }
}

export interface StatusChangeEvent {
  status: TaskStatus;
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
  onStatusChange: (event: StatusChangeEvent) => void
): Promise<AbortController> {
  const controller = new AbortController();
  const url = `http://127.0.0.1:${port}/event`;

  startEventLoop(url, taskId, controller.signal, onStatusChange);

  return controller;
}

async function startEventLoop(
  url: string,
  taskId: string,
  signal: AbortSignal,
  onStatusChange: (event: StatusChangeEvent) => void
): Promise<void> {
  let retries = 0;
  const maxRetries = 10;

  while (!signal.aborted && retries < maxRetries) {
    try {
      console.log(`[sse:${taskId.slice(0, 8)}] connecting to ${url}`);
      const response = await fetch(url, {
        headers: { Accept: "text/event-stream" },
        signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      console.log(`[sse:${taskId.slice(0, 8)}] connected`);
      retries = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[sse:${taskId.slice(0, 8)}] stream ended`);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const block of lines) {
          const dataLine = block
            .split("\n")
            .find((l) => l.startsWith("data:"));
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
      console.warn(
        `[sse:${taskId.slice(0, 8)}] connection lost (${msg}), retry ${retries}/${maxRetries} in ${backoff}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }

  if (retries >= maxRetries) {
    console.error(`[sse:${taskId.slice(0, 8)}] gave up after ${maxRetries} retries`);
  }
}

// Track port per task so we can fetch questions
const taskPorts = new Map<string, number>();

export function setTaskPort(taskId: string, port: number): void {
  taskPorts.set(taskId, port);
}

function handleSSEEvent(
  data: Record<string, unknown>,
  taskId: string,
  onStatusChange: (event: StatusChangeEvent) => void
): void {
  const eventType = data.type as string;

  console.log(`[sse:${taskId.slice(0, 8)}] event: ${eventType}`);

  broadcast({ type: "agent:event", taskId, event: data });

  // Agent is asking questions (plan mode question tool)
  if (eventType === "question.asked") {
    const port = taskPorts.get(taskId);
    if (port) {
      // Fetch the full question data from the API
      fetchQuestions(port, taskId, onStatusChange);
    } else {
      console.warn(`[sse:${taskId.slice(0, 8)}] question.asked but no port registered`);
      onStatusChange({ status: "needs_input" });
    }
  }

  // Question was answered — agent resumes
  if (eventType === "question.answered") {
    console.log(`[sse:${taskId.slice(0, 8)}] question answered, agent resuming`);
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
    console.log(`[sse:${taskId.slice(0, 8)}] permission requested: ${props.title} (${props.id})`);
    onStatusChange({
      status: "needs_input",
      permission: props,
    });
  }

  // Permission was replied to — agent should resume
  if (eventType === "permission.replied") {
    console.log(`[sse:${taskId.slice(0, 8)}] permission replied, agent resuming`);
    onStatusChange({ status: "agent_running" });
  }

  // Session is idle — agent finished its current turn
  if (eventType === "session.idle") {
    const props = data.properties as { sessionID: string };
    console.log(`[sse:${taskId.slice(0, 8)}] session idle: ${props.sessionID}`);
    onStatusChange({ status: "agent_done" });
  }

  // Session error
  if (eventType === "session.error") {
    const props = data.properties as { error?: { data?: { message?: string } } };
    const errorMsg = props.error?.data?.message ?? JSON.stringify(props.error);
    console.error(`[sse:${taskId.slice(0, 8)}] session error: ${errorMsg}`);
    onStatusChange({ status: "failed", error: errorMsg });
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
  onStatusChange: (event: StatusChangeEvent) => void
): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/question`);
    if (!res.ok) {
      console.warn(`[sse:${taskId.slice(0, 8)}] failed to fetch questions: ${res.status}`);
      onStatusChange({ status: "needs_input" });
      return;
    }
    const questions: OpenCodeQuestion[] = await res.json();
    if (questions.length > 0) {
      const q = questions[0];
      console.log(`[sse:${taskId.slice(0, 8)}] question: ${q.id} (${q.questions.length} sub-questions)`);
      onStatusChange({ status: "needs_input", question: q });
    } else {
      onStatusChange({ status: "needs_input" });
    }
  } catch (err) {
    console.warn(`[sse:${taskId.slice(0, 8)}] error fetching questions:`, err);
    onStatusChange({ status: "needs_input" });
  }
}
