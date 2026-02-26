import { execa } from "execa";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { OPENCODE_BIN } from "@agentco/shared";
import * as logger from "../lib/log.js";

// Re-export SDK types used by other modules
export type { FileDiff, QuestionRequest } from "@opencode-ai/sdk/v2";

// Keyed by port number — unique per OpenCode instance even when
// multiple instances share the same worktree (team mode).
const processes = new Map<number, ReturnType<typeof execa>>();

export async function startOpencode(
  worktreePath: string,
  port: number,
  dashboardOrigin: string,
): Promise<void> {
  logger.debug(
    "[opencode]",
    `spawning: ${OPENCODE_BIN} serve --port ${port} --cors ${dashboardOrigin}`,
  );
  logger.debug("[opencode]", `cwd: ${worktreePath}`);

  const proc = execa(
    OPENCODE_BIN,
    ["serve", "--port", String(port), "--cors", dashboardOrigin, "--print-logs"],
    {
      cwd: worktreePath,
      reject: false,
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    },
  );

  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) logger.debug(`[opencode:${port}]`, text);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (!text) return;
    if (text.includes("ERROR") || text.includes("WARN")) {
      logger.error(`[opencode:${port}:err]`, text);
    } else {
      logger.debug(`[opencode:${port}:err]`, text);
    }
  });

  proc.on("exit", (code) => {
    logger.info(`[opencode:${port}]`, `process exited with code ${code}`);
    processes.delete(port);
  });

  processes.set(port, proc);

  const healthy = await waitForHealth(`http://127.0.0.1:${port}`, 30_000);
  if (!healthy) {
    await stopOpencode(port);
    throw new Error(`OpenCode failed to start on port ${port}`);
  }
}

export async function stopOpencode(port: number): Promise<void> {
  processes.delete(port);

  // Kill the server (LISTEN) and any attached clients (ESTABLISHED),
  // but never kill our own process.
  await killProcessOnPort(port, "-sTCP:LISTEN");
  await killProcessOnPort(port, "-sTCP:ESTABLISHED");
}

async function killProcessOnPort(port: number, stateFilter: string): Promise<void> {
  const self = process.pid;
  try {
    const { stdout } = await execa("lsof", ["-ti", `tcp:${port}`, stateFilter]);
    const pids = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number)
      .filter((pid) => pid !== self);

    if (pids.length === 0) return;

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Already dead
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));

    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already dead
      }
    }
  } catch {
    // lsof found nothing — port is already free
  }
}

export async function checkHealth(port: number, retries = 5): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/global/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return true;
    } catch {
      // Not ready yet
    }
    if (i < retries - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/global/health`);
      if (res.ok) return true;
    } catch {
      // Not ready
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function createClient(port: number) {
  return createOpencodeClient({
    baseUrl: `http://127.0.0.1:${port}`,
  });
}

export async function createSession(port: number, title: string): Promise<string> {
  const client = createClient(port);
  const result = await client.session.create({ title });
  if (!result.data) {
    throw new Error("Failed to create OpenCode session");
  }
  return result.data.id;
}

export async function sendPrompt(
  port: number,
  sessionId: string,
  text: string,
  options?: {
    model?: { providerID: string; modelID: string };
    agent?: string;
  },
): Promise<void> {
  // Use promptAsync so we don't block waiting for the agent to finish.
  // We monitor progress via SSE events instead.
  const client = createClient(port);
  await client.session.promptAsync({
    sessionID: sessionId,
    parts: [{ type: "text", text }],
    ...(options?.model && { model: options.model }),
    ...(options?.agent && { agent: options.agent }),
  });
}

export async function abortSession(port: number, sessionId: string): Promise<void> {
  const client = createClient(port);
  await client.session.abort({ sessionID: sessionId });
}

export async function respondToPermission(
  port: number,
  permissionId: string,
  response: "once" | "always" | "reject",
): Promise<void> {
  const client = createClient(port);
  await client.permission.reply({
    requestID: permissionId,
    reply: response,
  });
}

export async function getSessionDiff(
  port: number,
  sessionId: string,
): Promise<import("@opencode-ai/sdk/v2").FileDiff[]> {
  const client = createClient(port);
  const result = await client.session.diff({ sessionID: sessionId });
  return result.data ?? [];
}

export async function getSessionMessages(
  port: number,
  sessionId: string,
): Promise<
  Array<{
    info: import("@opencode-ai/sdk/v2").Message;
    parts: Array<import("@opencode-ai/sdk/v2").Part>;
  }>
> {
  const client = createClient(port);
  const result = await client.session.messages({ sessionID: sessionId });
  return result.data ?? [];
}

export async function answerQuestion(
  port: number,
  questionId: string,
  answers: string[][],
): Promise<void> {
  const client = createClient(port);
  await client.question.reply({
    requestID: questionId,
    answers,
  });
}
