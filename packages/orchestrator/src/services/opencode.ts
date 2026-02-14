import { execa } from "execa";
import { createOpencodeClient } from "@opencode-ai/sdk";

const processes = new Map<string, ReturnType<typeof execa>>();

export async function startOpencode(
  worktreePath: string,
  port: number,
  dashboardOrigin: string
): Promise<void> {
  console.log(`[opencode] spawning: opencode serve --port ${port} --cors ${dashboardOrigin}`);
  console.log(`[opencode] cwd: ${worktreePath}`);

  const proc = execa("opencode", ["serve", "--port", String(port), "--cors", dashboardOrigin, "--print-logs"], {
    cwd: worktreePath,
    reject: false,
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });

  // Log stdout/stderr for debugging
  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.log(`[opencode:${port}] ${text}`);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) console.error(`[opencode:${port}:err] ${text}`);
  });

  proc.on("exit", (code) => {
    console.log(`[opencode:${port}] process exited with code ${code}`);
    processes.delete(worktreePath);
  });

  processes.set(worktreePath, proc);

  const healthy = await waitForHealth(`http://127.0.0.1:${port}`, 30_000);
  if (!healthy) {
    await stopOpencode(worktreePath, port);
    throw new Error(`OpenCode failed to start on port ${port}`);
  }
}

export async function stopOpencode(worktreePath: string, port?: number): Promise<void> {
  processes.delete(worktreePath);

  if (port) {
    // Kill the server (LISTEN) and any attached clients (ESTABLISHED),
    // but never kill our own process.
    await killProcessOnPort(port, "-sTCP:LISTEN");
    await killProcessOnPort(port, "-sTCP:ESTABLISHED");
  }
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

export async function createSession(
  port: number,
  title: string
): Promise<string> {
  const client = createClient(port);
  const result = await client.session.create({
    body: { title },
  });
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
  }
): Promise<void> {
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text }],
  };
  if (options?.model) body.model = options.model;
  if (options?.agent) body.agent = options.agent;

  // Use prompt_async so we don't block waiting for the agent to finish.
  // We monitor progress via SSE events instead.
  const res = await fetch(`http://127.0.0.1:${port}/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`prompt_async failed (${res.status}): ${text}`);
  }
}

export async function abortSession(
  port: number,
  sessionId: string
): Promise<void> {
  const client = createClient(port);
  await client.session.abort({
    path: { id: sessionId },
  });
}

export async function respondToPermission(
  port: number,
  sessionId: string,
  permissionId: string,
  response: "once" | "always" | "reject"
): Promise<void> {
  const client = createClient(port);
  await client.postSessionIdPermissionsPermissionId({
    path: { id: sessionId, permissionID: permissionId },
    body: { response },
  });
}

export interface OpenCodeQuestion {
  id: string;
  sessionID: string;
  questions: Array<{
    question: string;
    header: string;
    multiple?: boolean;
    options: Array<{
      label: string;
      description: string;
    }>;
  }>;
  tool: {
    messageID: string;
    callID: string;
  };
}

export async function listQuestions(port: number): Promise<OpenCodeQuestion[]> {
  const res = await fetch(`http://127.0.0.1:${port}/question`);
  if (!res.ok) return [];
  return res.json();
}

export async function answerQuestion(
  port: number,
  questionId: string,
  answers: string[][]
): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${port}/question/${questionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to answer question (${res.status}): ${text}`);
  }
}
