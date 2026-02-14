import { eq, inArray } from "drizzle-orm";
import { db, schema, findTask, findProject, type Task, type Project } from "../db/index.js";
import type { AgentCoConfig, TaskStatus, AlertType } from "../types.js";
import * as git from "./git.js";
import * as environment from "./environment.js";
import * as database from "./database.js";
import * as opencode from "./opencode.js";
import * as devPreview from "./dev-preview.js";
import * as pr from "./pr.js";
import * as portAllocator from "./port-allocator.js";
import { broadcast, monitorOpenCodeEvents, setTaskPort, type StatusChangeEvent } from "./event-monitor.js";

const eventControllers = new Map<string, AbortController>();

function log(taskId: string, message: string) {
  console.log(`[task:${taskId.slice(0, 8)}] ${message}`);
}

function updateTaskStatus(taskId: string, status: TaskStatus, extra?: Record<string, unknown>) {
  log(taskId, `status → ${status}`);
  db.update(schema.tasks)
    .set({ status, updatedAt: new Date().toISOString(), ...extra } as any)
    .where(eq(schema.tasks.id, taskId))
    .run();

  broadcast({ type: "task:status_changed", taskId, status });
}

function updateTaskError(taskId: string, error: string) {
  log(taskId, `ERROR: ${error}`);
  updateTaskStatus(taskId, "failed", { error });
}

function createAlert(taskId: string, type: AlertType, message: string, metadata?: Record<string, unknown>) {
  const id = crypto.randomUUID();
  db.insert(schema.alerts)
    .values({ id, taskId, type, message, metadata })
    .run();

  broadcast({
    type: "task:alert",
    taskId,
    alert: {
      id,
      taskId,
      type,
      message,
      metadata,
      read: false,
      createdAt: new Date().toISOString(),
    },
  });
}

function requireTask(taskId: string): Task {
  const task = findTask(eq(schema.tasks.id, taskId));
  if (!task) throw new Error(`Task ${taskId} not found`);
  return task;
}

function requireProject(projectId: string): Project {
  const project = findProject(eq(schema.projects.id, projectId));
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project;
}

export async function startTask(taskId: string): Promise<void> {
  const task = requireTask(taskId);
  const project = requireProject(task.projectId);
  const config = project.config as AgentCoConfig | null;

  try {
    updateTaskStatus(taskId, "setting_up");

    // Git setup
    log(taskId, `git fetch origin in ${project.rootPath}`);
    await git.fetchOrigin(project.rootPath);

    log(taskId, `git pull origin main`);
    await git.pullMain(project.rootPath);

    const worktreePath = await git.resolveWorktreePath(project.slug, task.slug);
    const branchName = git.resolveBranchName(task.slug);

    log(taskId, `creating worktree at ${worktreePath} on branch ${branchName}`);
    await git.createWorktree(project.rootPath, worktreePath, branchName);

    db.update(schema.tasks)
      .set({ worktreePath, branchName })
      .where(eq(schema.tasks.id, taskId))
      .run();

    // Environment setup
    if (config?.copyOnWorktree?.length) {
      log(taskId, `copying files to worktree: ${config.copyOnWorktree.join(", ")}`);
      await environment.copyWorktreeFiles(project.rootPath, worktreePath, config.copyOnWorktree);
    }

    // Database provisioning
    let databaseUrl: string | undefined;
    if (config?.database && config.database.type === "postgres") {
      log(taskId, `provisioning database`);
      const dbResult = await database.createDatabase(
        config.database.connectionString,
        project.slug,
        task.slug
      );

      db.update(schema.tasks)
        .set({ databaseName: dbResult.databaseName })
        .where(eq(schema.tasks.id, taskId))
        .run();

      databaseUrl = dbResult.databaseUrl;
      log(taskId, `database created: ${dbResult.databaseName}`);
    }

    // Allocate ports
    const opencodePort = await portAllocator.allocatePort("opencode");
    log(taskId, `allocated opencode port: ${opencodePort}`);
    db.update(schema.tasks)
      .set({ opencodePort })
      .where(eq(schema.tasks.id, taskId))
      .run();

    // Env overrides
    if (config?.envOverrides) {
      const resolvedValues: Record<string, string> = {};

      if (config.envOverrides.PORT === "auto") {
        const devPort = await portAllocator.allocatePort("devPreview");
        resolvedValues.PORT = String(devPort);
        log(taskId, `allocated dev preview port: ${devPort}`);
        db.update(schema.tasks)
          .set({ devPreviewPort: devPort })
          .where(eq(schema.tasks.id, taskId))
          .run();
      }

      if (config.envOverrides.DATABASE_URL === "auto" && databaseUrl) {
        resolvedValues.DATABASE_URL = databaseUrl;
      }

      log(taskId, `writing .env overrides`);
      await environment.writeEnvFile(worktreePath, project.rootPath, config.envOverrides, resolvedValues);
    }

    // Migrations
    if (config?.database?.migrateCommand && databaseUrl) {
      log(taskId, `running migrations: ${config.database.migrateCommand}`);
      await database.runMigrations(worktreePath, config.database.migrateCommand);
    }
    if (config?.database?.seedCommand && databaseUrl) {
      log(taskId, `running seed: ${config.database.seedCommand}`);
      await database.runSeed(worktreePath, config.database.seedCommand);
    }

    // Start OpenCode
    log(taskId, `starting opencode serve on port ${opencodePort} in ${worktreePath}`);
    await opencode.startOpencode(worktreePath, opencodePort, "http://localhost:3000");
    log(taskId, `opencode is healthy`);

    // Create session and send prompt
    log(taskId, `creating opencode session`);
    const sessionId = await opencode.createSession(opencodePort, task.slug);
    log(taskId, `session created: ${sessionId}`);

    db.update(schema.tasks)
      .set({ opencodeSessionId: sessionId })
      .where(eq(schema.tasks.id, taskId))
      .run();

    updateTaskStatus(taskId, "agent_running");

    const DEFAULT_MODEL = "anthropic/claude-opus-4-6";
    const modelString = config?.agent?.defaultModel || DEFAULT_MODEL;
    const model = parseModelId(modelString);

    const agent = "plan";
    log(taskId, `sending prompt to ${agent} agent (model: ${modelString})`);
    await opencode.sendPrompt(opencodePort, sessionId, task.description, { model, agent });

    // Monitor SSE events
    log(taskId, `subscribing to SSE events`);
    setTaskPort(taskId, opencodePort);
    const controller = await monitorOpenCodeEvents(
      opencodePort,
      taskId,
      buildEventHandler(taskId)
    );

    eventControllers.set(taskId, controller);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateTaskError(taskId, message);
    createAlert(taskId, "error", `Task setup failed: ${message}`);
    throw err;
  }
}

export async function startDevPreviewForTask(taskId: string): Promise<string | null> {
  const task = requireTask(taskId);
  if (!task.worktreePath) throw new Error(`Task ${taskId} has no worktree`);

  const project = requireProject(task.projectId);
  const config = project.config as AgentCoConfig | null;
  if (!config?.devPreview) return null;

  let devPort = task.devPreviewPort;
  if (!devPort) {
    devPort = await portAllocator.allocatePort("devPreview");
    db.update(schema.tasks)
      .set({ devPreviewPort: devPort })
      .where(eq(schema.tasks.id, taskId))
      .run();
  }

  const env: Record<string, string> = {};
  if (config.devPreview.portEnvVar) {
    env[config.devPreview.portEnvVar] = String(devPort);
  }

  log(taskId, `starting dev preview on port ${devPort}`);
  await devPreview.startDevPreview(task.worktreePath, config.devPreview.command, devPort, env, {
    healthCheck: config.devPreview.healthCheck,
    readyPattern: config.devPreview.readyPattern,
  });

  updateTaskStatus(taskId, "preview_live");
  createAlert(taskId, "preview_live", `Dev preview live on port ${devPort}`, {
    port: devPort,
    url: `/preview/${taskId}/`,
  });

  return `/preview/${taskId}/`;
}

export async function createPR(taskId: string): Promise<string> {
  const task = requireTask(taskId);
  if (!task.worktreePath || !task.branchName) {
    throw new Error(`Task ${taskId} is not set up for PR creation`);
  }

  log(taskId, `creating PR on branch ${task.branchName}`);
  const prUrl = await pr.createPullRequest(
    task.worktreePath,
    task.branchName,
    task.title,
    task.description
  );

  db.update(schema.tasks)
    .set({ prUrl })
    .where(eq(schema.tasks.id, taskId))
    .run();

  updateTaskStatus(taskId, "pr_created");
  createAlert(taskId, "pr_created", `PR created: ${prUrl}`, { prUrl });

  return prUrl;
}

export async function abortTask(taskId: string): Promise<void> {
  const task = requireTask(taskId);
  log(taskId, `aborting task`);

  if (task.opencodePort && task.opencodeSessionId) {
    try {
      await opencode.abortSession(task.opencodePort, task.opencodeSessionId);
    } catch {
      // Session may already be done
    }
  }

  const controller = eventControllers.get(taskId);
  if (controller) {
    controller.abort();
    eventControllers.delete(taskId);
  }
}

export async function cleanupTask(taskId: string): Promise<void> {
  const task = requireTask(taskId);
  const project = requireProject(task.projectId);
  const config = project.config as AgentCoConfig | null;

  log(taskId, `cleaning up task`);

  const controller = eventControllers.get(taskId);
  if (controller) {
    controller.abort();
    eventControllers.delete(taskId);
  }

  if (task.worktreePath) {
    log(taskId, `stopping dev preview and opencode`);
    await devPreview.stopDevPreview(task.worktreePath).catch(() => {});
    await opencode.stopOpencode(task.worktreePath, task.opencodePort ?? undefined).catch(() => {});
  }

  if (task.databaseName && config?.database?.connectionString) {
    log(taskId, `dropping database ${task.databaseName}`);
    await database
      .dropDatabase(config.database.connectionString, task.databaseName)
      .catch((err) => console.error("Failed to drop database:", err));
  }

  if (task.worktreePath) {
    log(taskId, `removing worktree ${task.worktreePath}`);
    await git
      .removeWorktree(project.rootPath, task.worktreePath)
      .catch((err) => console.error("Failed to remove worktree:", err));
  }

  if (task.branchName) {
    log(taskId, `deleting branch ${task.branchName}`);
    await git
      .deleteBranch(project.rootPath, task.branchName)
      .catch((err) => console.error("Failed to delete branch:", err));
  }

  updateTaskStatus(taskId, "archived");
}

function buildEventHandler(taskId: string) {
  return (event: StatusChangeEvent) => {
    updateTaskStatus(taskId, event.status);

    if (event.status === "needs_input" && event.question) {
      const q = event.question;
      const headers = q.questions.map((sub) => sub.header).join(", ");
      createAlert(taskId, "needs_question", `Agent is asking: ${headers}`, {
        questionID: q.id,
        sessionID: q.sessionID,
        questions: q.questions,
      });
    }

    if (event.status === "needs_input" && event.permission) {
      createAlert(taskId, "needs_permission", event.permission.title, {
        permissionID: event.permission.id,
        sessionID: event.permission.sessionID,
        ...event.permission.metadata,
      });
    }

    if (event.status === "agent_done") {
      createAlert(taskId, "agent_complete", "Agent has completed its turn");
    }

    if (event.status === "failed" && event.error) {
      createAlert(taskId, "error", `Agent error: ${event.error}`);
    }
  };
}

export async function reconnectActiveTasks(): Promise<void> {
  const activeStatuses: TaskStatus[] = [
    "setting_up",
    "agent_running",
    "needs_input",
    "agent_done",
    "preview_live",
  ];

  const activeTasks = db
    .select()
    .from(schema.tasks)
    .where(inArray(schema.tasks.status, activeStatuses))
    .all();

  if (activeTasks.length === 0) {
    console.log("[reconnect] no active tasks to reconnect");
    return;
  }

  console.log(`[reconnect] found ${activeTasks.length} active task(s), checking health...`);

  for (const task of activeTasks) {
    if (!task.opencodePort) {
      console.log(`[reconnect] task ${task.id.slice(0, 8)} has no port, skipping`);
      continue;
    }

    console.log(`[reconnect] task ${task.id.slice(0, 8)} checking port ${task.opencodePort}...`);
    const alive = await opencode.checkHealth(task.opencodePort);
    console.log(`[reconnect] task ${task.id.slice(0, 8)} health: ${alive}`);

    if (alive) {
      setTaskPort(task.id, task.opencodePort);
      const controller = await monitorOpenCodeEvents(
        task.opencodePort,
        task.id,
        buildEventHandler(task.id)
      );

      eventControllers.set(task.id, controller);
      console.log(`[reconnect] task ${task.id.slice(0, 8)} SSE reconnected`);
    } else {
      console.log(`[reconnect] task ${task.id.slice(0, 8)} is dead, marking failed`);
      updateTaskError(task.id, "OpenCode process died while orchestrator was offline");
    }
  }
}

function parseModelId(modelString: string): { providerID: string; modelID: string } | undefined {
  const parts = modelString.split("/");
  if (parts.length !== 2) return undefined;
  return { providerID: parts[0], modelID: parts[1] };
}
