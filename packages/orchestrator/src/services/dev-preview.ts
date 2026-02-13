import { execa } from "execa";

const processes = new Map<string, ReturnType<typeof execa>>();

export async function startDevPreview(
  worktreePath: string,
  command: string,
  port: number,
  env: Record<string, string>,
  options?: {
    healthCheck?: string;
    readyPattern?: string;
  }
): Promise<void> {
  const [cmd, ...args] = command.split(" ");
  const proc = execa(cmd, args, {
    cwd: worktreePath,
    reject: false,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  processes.set(worktreePath, proc);

  if (options?.readyPattern) {
    await waitForStdoutPattern(proc, options.readyPattern, 60_000);
  } else if (options?.healthCheck) {
    await waitForHealthCheck(
      `http://127.0.0.1:${port}${options.healthCheck}`,
      60_000
    );
  } else {
    // Default: wait a few seconds for the server to start
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

export async function stopDevPreview(worktreePath: string): Promise<void> {
  const proc = processes.get(worktreePath);
  if (proc) {
    proc.kill("SIGTERM");
    processes.delete(worktreePath);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function waitForStdoutPattern(
  proc: ReturnType<typeof execa>,
  pattern: string,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Dev preview did not match pattern "${pattern}" within ${timeoutMs}ms`));
    }, timeoutMs);

    if (proc.stdout) {
      proc.stdout.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        if (text.includes(pattern)) {
          clearTimeout(timeout);
          resolve();
        }
      });
    }

    proc.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Dev preview exited with code ${code}`));
      }
    });
  });
}

async function waitForHealthCheck(
  url: string,
  timeoutMs: number
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Dev preview health check failed after ${timeoutMs}ms`);
}
