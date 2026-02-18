import { eq, inArray } from "drizzle-orm";
import { db, schema, findTask, findProject, findTeamMembers, type Task, type Project, type TeamMember } from "../db/index.js";
import type { AgentCoConfig, TaskStatus, AlertType, TeamPlan, TeamMemberStatus } from "../types.js";
import * as git from "./git.js";
import * as environment from "./environment.js";
import * as database from "./database.js";
import * as opencode from "./opencode.js";
import * as devPreview from "./dev-preview.js";
import * as pr from "./pr.js";
import * as portAllocator from "./port-allocator.js";
import { broadcast, monitorOpenCodeEvents, setTaskPort, clearTaskAgentMode, type StatusChangeEvent } from "./event-monitor.js";
import { analyzeCompletion } from "./action-items.js";
import fs from "node:fs";
import path from "node:path";
import * as logger from "../lib/log.js";

const eventControllers = new Map<string, AbortController>();
const taskAgentMode = new Map<string, "plan" | "build">();

function taskPrefix(taskId: string) {
  return `[task:${taskId.slice(0, 8)}]`;
}

function log(taskId: string, message: string) {
  logger.info(taskPrefix(taskId), message);
}

function logd(taskId: string, message: string) {
  logger.debug(taskPrefix(taskId), message);
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
      metadata: metadata ?? null,
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

interface InfrastructureResult {
  worktreePath: string;
  branchName: string;
  databaseUrl?: string;
}

async function setupTaskInfrastructure(
  taskId: string,
  task: Task,
  project: Project,
  config: AgentCoConfig | null
): Promise<InfrastructureResult> {
  // Git setup
  logd(taskId, `git fetch origin in ${project.rootPath}`);
  await git.fetchOrigin(project.rootPath);

  logd(taskId, `git pull origin main`);
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
    logd(taskId, `copying files to worktree: ${config.copyOnWorktree.join(", ")}`);
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

    logd(taskId, `writing .env overrides`);
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

  return { worktreePath, branchName, databaseUrl };
}

export async function startTask(taskId: string): Promise<void> {
  const task = requireTask(taskId);
  const project = requireProject(task.projectId);
  const config = project.config as AgentCoConfig | null;

  try {
    updateTaskStatus(taskId, "setting_up");

    const infra = await setupTaskInfrastructure(taskId, task, project, config);

    if (task.mode === "team") {
      await startTeamTask(taskId, task, project, config, infra);
    } else {
      await startSoloTask(taskId, task, config, infra);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateTaskError(taskId, message);
    createAlert(taskId, "error", `Task setup failed: ${message}`);
    throw err;
  }
}

async function startSoloTask(
  taskId: string,
  task: Task,
  config: AgentCoConfig | null,
  infra: InfrastructureResult
): Promise<void> {
  // Allocate port
  const opencodePort = await portAllocator.allocatePort("opencode");
  log(taskId, `allocated opencode port: ${opencodePort}`);
  db.update(schema.tasks)
    .set({ opencodePort })
    .where(eq(schema.tasks.id, taskId))
    .run();

  // Start OpenCode
  log(taskId, `starting opencode serve on port ${opencodePort} in ${infra.worktreePath}`);
  await opencode.startOpencode(infra.worktreePath, opencodePort, "http://localhost:3000");
  logd(taskId, `opencode is healthy`);

  // Create session and send prompt
  logd(taskId, `creating opencode session`);
  const sessionId = await opencode.createSession(opencodePort, task.slug);
  log(taskId, `session created: ${sessionId}`);

  db.update(schema.tasks)
    .set({ opencodeSessionId: sessionId })
    .where(eq(schema.tasks.id, taskId))
    .run();

  updateTaskStatus(taskId, "agent_running");

  const DEFAULT_MODEL = "anthropic/claude-opus-4-6";
  const modelString = task.model || config?.agent?.defaultModel || DEFAULT_MODEL;
  const model = parseModelId(modelString);

  const agent = "plan";
  taskAgentMode.set(taskId, "plan");
  log(taskId, `sending prompt to ${agent} agent (model: ${modelString})`);
  await opencode.sendPrompt(opencodePort, sessionId, task.description, { model, agent });

  // Monitor SSE events
  logd(taskId, `subscribing to SSE events`);
  setTaskPort(taskId, opencodePort);
  const controller = await monitorOpenCodeEvents(
    opencodePort,
    taskId,
    buildEventHandler(taskId)
  );

  eventControllers.set(taskId, controller);
}

// --- Team mode ---

const TEAM_PLAN_PATH = ".agentco/team-plan.json";

const COORDINATOR_SYSTEM_PROMPT = `You are a team coordinator. Your job is to analyze the task and create a plan that divides work among team members who will execute in parallel.

Analyze the task and produce a team plan. Write the plan as JSON to the file .agentco/team-plan.json with this exact schema:

{
  "members": [
    {
      "label": "short-name",
      "tasks": ["task description 1", "task description 2"],
      "files": ["src/path/file1.ts", "src/path/file2.ts"]
    }
  ]
}

Rules:
- Each member should have a clear, non-overlapping set of files to modify.
- Two members MUST NOT be assigned the same file. File conflicts cause corruption.
- Use 1-4 members depending on task complexity. Don't over-parallelize.
- Labels should be short and descriptive (e.g. "frontend", "api", "tests", "docs").
- The "files" array should list all files the member is expected to create or modify.
- After writing the plan file, stop and wait. Your team will be assembled automatically.

Here is the task:

`;

function buildMemberPrompt(label: string, tasks: string[], files: string[]): string {
  const taskList = tasks.map((t) => `- ${t}`).join("\n");
  const fileList = files.map((f) => `- ${f}`).join("\n");

  return `You are a team member working on a coding task. Your role: ${label}

Your assigned tasks:
${taskList}

Your assigned files (you may ONLY create/modify these files):
${fileList}

You may read any file in the repository for context, but you must ONLY write to your assigned files. Modifying other files will cause conflicts with other team members working in parallel.

Focus on your assigned tasks. When you are done, stop and report completion.`;
}

function updateTeamMemberStatus(taskId: string, memberId: string, label: string, status: TeamMemberStatus) {
  db.update(schema.teamMembers)
    .set({ status })
    .where(eq(schema.teamMembers.id, memberId))
    .run();

  broadcast({ type: "team:member_status", taskId, memberId, label, status });
}

function readTeamPlan(worktreePath: string): TeamPlan {
  const planPath = path.join(worktreePath, TEAM_PLAN_PATH);

  if (!fs.existsSync(planPath)) {
    throw new Error(`Team plan not found at ${TEAM_PLAN_PATH}. The coordinator must write this file.`);
  }

  const raw = fs.readFileSync(planPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Team plan at ${TEAM_PLAN_PATH} is not valid JSON.`);
  }

  const plan = parsed as TeamPlan;
  if (!plan.members || !Array.isArray(plan.members) || plan.members.length === 0) {
    throw new Error(`Team plan must have a non-empty "members" array.`);
  }

  for (const member of plan.members) {
    if (!member.label || typeof member.label !== "string") {
      throw new Error(`Each team member must have a "label" string.`);
    }
    if (!Array.isArray(member.tasks) || member.tasks.length === 0) {
      throw new Error(`Team member "${member.label}" must have a non-empty "tasks" array.`);
    }
    if (!Array.isArray(member.files)) {
      throw new Error(`Team member "${member.label}" must have a "files" array.`);
    }
  }

  if (plan.members.length > 8) {
    throw new Error(`Team plan has ${plan.members.length} members. Maximum is 8.`);
  }

  return plan;
}

async function startTeamTask(
  taskId: string,
  task: Task,
  project: Project,
  config: AgentCoConfig | null,
  infra: InfrastructureResult
): Promise<void> {
  // Create .agentco directory in worktree for plan file
  const agentcoDir = path.join(infra.worktreePath, ".agentco");
  fs.mkdirSync(agentcoDir, { recursive: true });

  // Allocate port for the leader
  const leaderPort = await portAllocator.allocatePort("opencode");
  log(taskId, `allocated leader opencode port: ${leaderPort}`);

  // Start leader OpenCode instance
  log(taskId, `starting leader opencode on port ${leaderPort} in ${infra.worktreePath}`);
  await opencode.startOpencode(infra.worktreePath, leaderPort, "http://localhost:3000");
  logd(taskId, `leader opencode is healthy`);

  // Create leader session
  logd(taskId, `creating leader session`);
  const leaderSessionId = await opencode.createSession(leaderPort, `${task.slug}-leader`);
  log(taskId, `leader session created: ${leaderSessionId}`);

  // Insert leader into team_members table
  const leaderId = crypto.randomUUID();
  db.insert(schema.teamMembers)
    .values({
      id: leaderId,
      taskId,
      role: "leader",
      label: "leader",
      opencodePort: leaderPort,
      opencodeSessionId: leaderSessionId,
      status: "running",
    })
    .run();

  updateTaskStatus(taskId, "agent_running");

  // Send coordinator prompt
  const DEFAULT_MODEL = "anthropic/claude-opus-4-6";
  const modelString = task.model || config?.agent?.defaultModel || DEFAULT_MODEL;
  const model = parseModelId(modelString);

  taskAgentMode.set(taskId, "plan");
  log(taskId, `sending coordinator prompt to leader (model: ${modelString})`);
  await opencode.sendPrompt(leaderPort, leaderSessionId, COORDINATOR_SYSTEM_PROMPT + task.description, {
    model,
    agent: "plan",
  });

  // Monitor leader SSE events
  logd(taskId, `subscribing to leader SSE events`);
  setTaskPort(taskId, leaderPort);
  const leaderController = await monitorOpenCodeEvents(
    leaderPort,
    taskId,
    buildTeamEventHandler(taskId, leaderId, "leader", infra, task, config)
  );

  eventControllers.set(`${taskId}:${leaderId}`, leaderController);
}

async function spawnTeamMembers(
  taskId: string,
  plan: TeamPlan,
  infra: InfrastructureResult,
  task: Task,
  config: AgentCoConfig | null
): Promise<void> {
  const DEFAULT_MODEL = "anthropic/claude-opus-4-6";
  const modelString = task.model || config?.agent?.defaultModel || DEFAULT_MODEL;
  const model = parseModelId(modelString);

  const labels: string[] = [];

  for (const memberDef of plan.members) {
    const memberPort = await portAllocator.allocatePort("opencode");
    log(taskId, `allocated port ${memberPort} for member "${memberDef.label}"`);

    // Start OpenCode instance in the shared worktree
    log(taskId, `starting opencode for "${memberDef.label}" on port ${memberPort}`);
    await opencode.startOpencode(infra.worktreePath, memberPort, "http://localhost:3000");

    // Create session
    const sessionId = await opencode.createSession(memberPort, `${task.slug}-${memberDef.label}`);
    log(taskId, `session created for "${memberDef.label}": ${sessionId}`);

    // Insert team member row
    const memberId = crypto.randomUUID();
    db.insert(schema.teamMembers)
      .values({
        id: memberId,
        taskId,
        role: "member",
        label: memberDef.label,
        opencodePort: memberPort,
        opencodeSessionId: sessionId,
        status: "running",
        assignedTasks: memberDef.tasks,
        assignedFiles: memberDef.files,
      })
      .run();

    // Send member-specific prompt
    const prompt = buildMemberPrompt(memberDef.label, memberDef.tasks, memberDef.files);
    log(taskId, `sending prompt to member "${memberDef.label}"`);
    await opencode.sendPrompt(memberPort, sessionId, prompt, { model, agent: "build" });

    // Monitor SSE events for this member
    setTaskPort(`${taskId}:${memberId}`, memberPort);
    const memberController = await monitorOpenCodeEvents(
      memberPort,
      taskId,
      buildTeamEventHandler(taskId, memberId, memberDef.label, infra, task, config)
    );

    eventControllers.set(`${taskId}:${memberId}`, memberController);
    labels.push(memberDef.label);
  }

  createAlert(taskId, "agent_complete", `Team assembled: ${labels.length} members (${labels.join(", ")})`);
  log(taskId, `all ${labels.length} team members spawned`);
}

function buildTeamEventHandler(
  taskId: string,
  memberId: string,
  memberLabel: string,
  infra: InfrastructureResult,
  task: Task,
  config: AgentCoConfig | null
) {
  let planParsed = false;

  return (event: StatusChangeEvent) => {
    const memberPrefix = `[${memberLabel}]`;

    // Track agent mode for the leader
    if (event.agentMode) {
      const key = `${taskId}:${memberId}`;
      const currentMode = taskAgentMode.get(key);
      if (currentMode !== event.agentMode) {
        logd(taskId, `${memberPrefix} agent mode: ${currentMode ?? "unknown"} → ${event.agentMode}`);
        taskAgentMode.set(key, event.agentMode as "plan" | "build");
      }
    }

    // Leader/member idle handling
    if (event.status === "agent_done") {
      const member = db.select().from(schema.teamMembers).where(eq(schema.teamMembers.id, memberId)).get();
      if (!member) return;

      if (member.role === "leader" && !planParsed) {
        const mode = taskAgentMode.get(`${taskId}:${memberId}`) || "plan";

        // Plan mode: same as solo — mark plan_ready so user can review and approve
        if (mode === "plan") {
          updateTaskStatus(taskId, "plan_ready");
          createAlert(taskId, "agent_complete", "Plan is ready for review");
          return;
        }

        // Build mode: leader has been approved and should be writing the team plan file.
        // session.idle fires between every agent turn, so if the file isn't there yet,
        // the leader is still working.
        const planPath = path.join(infra.worktreePath, TEAM_PLAN_PATH);
        if (!fs.existsSync(planPath)) {
          log(taskId, `${memberPrefix} leader idle in build mode, team plan file not written yet — waiting`);
          updateTaskStatus(taskId, "agent_running");
          return;
        }

        planParsed = true;
        log(taskId, `${memberPrefix} leader idle, reading team plan`);

        (async () => {
          try {
            const plan = readTeamPlan(infra.worktreePath);
            log(taskId, `team plan parsed: ${plan.members.length} members`);

            await spawnTeamMembers(taskId, plan, infra, task, config);

            // Resume the leader to let it know the team is active
            if (member.opencodePort && member.opencodeSessionId) {
              const resumeMsg = `Your team is now active with ${plan.members.length} members working on their assignments: ${plan.members.map((m) => m.label).join(", ")}. Monitor the shared worktree for their progress. When all work is complete, review the changes for integration issues.`;
              await opencode.sendPrompt(member.opencodePort, member.opencodeSessionId, resumeMsg);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(taskId, `failed to spawn team: ${msg}`);
            updateTaskError(taskId, `Team spawn failed: ${msg}`);
            createAlert(taskId, "error", `Team spawn failed: ${msg}`);
          }
        })();
        return;
      }

      // Member idle → update status
      if (member.role === "member") {
        updateTeamMemberStatus(taskId, memberId, memberLabel, "idle");
        log(taskId, `${memberPrefix} member idle`);

        // Check if all members are idle
        const allMembers = findTeamMembers(taskId);
        const workers = allMembers.filter((m) => m.role === "member");
        const allIdle = workers.every((m) => m.status === "idle");

        if (allIdle) {
          log(taskId, `all team members idle, notifying leader`);
          const leader = allMembers.find((m) => m.role === "leader");
          if (leader?.opencodePort && leader?.opencodeSessionId) {
            const completionMsg = `All team members have completed their work. Review the changes across the worktree, verify integration between the different components, and report any issues found.`;
            opencode.sendPrompt(leader.opencodePort, leader.opencodeSessionId, completionMsg).catch((err) => {
              log(taskId, `failed to notify leader of completion: ${err}`);
            });
          }
          return;
        }

        createAlert(taskId, "agent_complete", `${memberPrefix} Member completed its turn`, {
          teamMemberId: memberId,
          teamMemberLabel: memberLabel,
        });
        return;
      }

      // Leader idle after plan was already parsed → task is done
      if (member.role === "leader" && planParsed) {
        updateTeamMemberStatus(taskId, memberId, memberLabel, "idle");
        updateTaskStatus(taskId, "agent_done");
        createAlert(taskId, "agent_complete", "Team leader has completed synthesis");
        runPostCompletionAnalysis(taskId);
        return;
      }
    }

    // Forward needs_input events with member context
    if (event.status === "needs_input") {
      updateTaskStatus(taskId, event.status);

      if (event.question) {
        const q = event.question;
        const headers = q.questions.map((sub) => sub.header).join(", ");
        createAlert(taskId, "needs_question", `${memberPrefix} Agent is asking: ${headers}`, {
          questionID: q.id,
          sessionID: q.sessionID,
          questions: q.questions,
          teamMemberId: memberId,
          teamMemberLabel: memberLabel,
        });
        return;
      }

      if (event.permission) {
        createAlert(taskId, "needs_permission", `${memberPrefix} ${event.permission.title}`, {
          permissionID: event.permission.id,
          sessionID: event.permission.sessionID,
          ...event.permission.metadata,
          teamMemberId: memberId,
          teamMemberLabel: memberLabel,
        });
        return;
      }
    }

    // Agent running — update member and task status
    if (event.status === "agent_running") {
      updateTeamMemberStatus(taskId, memberId, memberLabel, "running");
      updateTaskStatus(taskId, "agent_running");
    }

    // Errors
    if (event.status === "failed") {
      updateTeamMemberStatus(taskId, memberId, memberLabel, "failed");
      createAlert(taskId, "error", `${memberPrefix} Agent error: ${event.error ?? "unknown"}`, {
        teamMemberId: memberId,
        teamMemberLabel: memberLabel,
      });
    }
  };
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

async function stopTeamMembers(taskId: string): Promise<void> {
  const members = findTeamMembers(taskId);
  if (members.length === 0) return;

  log(taskId, `stopping ${members.length} team member(s)`);

  for (const member of members) {
    // Stop SSE listener
    const key = `${taskId}:${member.id}`;
    const ctrl = eventControllers.get(key);
    if (ctrl) {
      ctrl.abort();
      eventControllers.delete(key);
    }
    taskAgentMode.delete(key);

    // Abort session
    if (member.opencodePort && member.opencodeSessionId) {
      await opencode.abortSession(member.opencodePort, member.opencodeSessionId).catch(() => {});
    }

    // Stop OpenCode process
    if (member.opencodePort) {
      await opencode.stopOpencode(member.opencodePort).catch(() => {});
      await portAllocator.releaseTeamMemberPort(member.id);
    }
  }
}

export async function abortTask(taskId: string): Promise<void> {
  const task = requireTask(taskId);
  log(taskId, `aborting task`);

  // Stop team members first (no-op for solo tasks)
  await stopTeamMembers(taskId);

  // Stop listening for SSE events (solo task controller keyed by taskId)
  const controller = eventControllers.get(taskId);
  if (controller) {
    controller.abort();
    eventControllers.delete(taskId);
  }

  // Tell the solo agent to stop its current turn
  if (task.opencodePort && task.opencodeSessionId) {
    try {
      await opencode.abortSession(task.opencodePort, task.opencodeSessionId);
    } catch {
      // Session may already be done
    }
  }

  // Kill the processes
  if (task.worktreePath) {
    log(taskId, `stopping dev preview`);
    await devPreview.stopDevPreview(task.worktreePath).catch(() => {});
  }
  if (task.opencodePort) {
    log(taskId, `stopping opencode on port ${task.opencodePort}`);
    await opencode.stopOpencode(task.opencodePort).catch(() => {});
  }

  // Release ports
  if (task.opencodePort) {
    await portAllocator.releasePort(taskId, "opencode");
  }
  if (task.devPreviewPort) {
    await portAllocator.releasePort(taskId, "devPreview");
  }

  taskAgentMode.delete(taskId);
  clearTaskAgentMode(taskId);
  updateTaskStatus(taskId, "aborted", { error: "Task aborted by user" });
}

export async function cleanupTask(taskId: string): Promise<void> {
  const task = requireTask(taskId);
  const project = requireProject(task.projectId);
  const config = project.config as AgentCoConfig | null;

  log(taskId, `cleaning up task`);

  // Stop team members first (no-op for solo tasks)
  await stopTeamMembers(taskId);

  // Stop solo SSE listener
  const controller = eventControllers.get(taskId);
  if (controller) {
    controller.abort();
    eventControllers.delete(taskId);
  }
  taskAgentMode.delete(taskId);
  clearTaskAgentMode(taskId);

  if (task.worktreePath) {
    log(taskId, `stopping dev preview`);
    await devPreview.stopDevPreview(task.worktreePath).catch(() => {});
  }
  if (task.opencodePort) {
    log(taskId, `stopping opencode on port ${task.opencodePort}`);
    await opencode.stopOpencode(task.opencodePort).catch(() => {});
  }

  if (task.databaseName && config?.database?.connectionString) {
    log(taskId, `dropping database ${task.databaseName}`);
    await database
      .dropDatabase(config.database.connectionString, task.databaseName)
      .catch((err) => logger.error(taskPrefix(taskId), `Failed to drop database: ${err}`));
  }

  // Worktree is shared — one removal covers all agents
  if (task.worktreePath) {
    log(taskId, `removing worktree ${task.worktreePath}`);
    await git
      .removeWorktree(project.rootPath, task.worktreePath)
      .catch((err) => logger.error(taskPrefix(taskId), `Failed to remove worktree: ${err}`));
  }

  if (task.branchName) {
    log(taskId, `deleting branch ${task.branchName}`);
    await git
      .deleteBranch(project.rootPath, task.branchName)
      .catch((err) => logger.error(taskPrefix(taskId), `Failed to delete branch: ${err}`));
  }

  updateTaskStatus(taskId, "archived");
}

function runPostCompletionAnalysis(taskId: string): void {
  const task = findTask(eq(schema.tasks.id, taskId));
  if (!task?.opencodePort || !task?.opencodeSessionId) {
    log(taskId, "skipping post-completion analysis: no port or session");
    return;
  }

  const port = task.opencodePort;
  const sessionId = task.opencodeSessionId;

  // Fire-and-forget: don't block the event handler
  (async () => {
    try {
      log(taskId, "running post-completion analysis");
      const diffs = await opencode.getSessionDiff(port, sessionId);
      log(taskId, `fetched ${diffs.length} file diff(s)`);

      const items = await analyzeCompletion(diffs);
      for (const item of items) {
        createAlert(taskId, "action_required", item.summary, {
          category: item.category,
          files: item.files,
        });
      }

      if (items.length > 0) {
        log(taskId, `created ${items.length} action item alert(s)`);
      } else {
        log(taskId, "no action items detected");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(taskId, `post-completion analysis failed: ${msg}`);
    }
  })();
}

function buildEventHandler(taskId: string) {
  return (event: StatusChangeEvent) => {
    // Update agent mode whenever we get a signal from SSE message.updated events
    if (event.agentMode) {
      const currentMode = taskAgentMode.get(taskId);
      if (currentMode !== event.agentMode) {
        logd(taskId, `agent mode: ${currentMode ?? "unknown"} → ${event.agentMode}`);
        taskAgentMode.set(taskId, event.agentMode as "plan" | "build");
      }
    }

    const mode = taskAgentMode.get(taskId) || "plan";

    // When session goes idle in plan mode, the plan is ready for approval
    if (event.status === "agent_done" && mode === "plan") {
      updateTaskStatus(taskId, "plan_ready");
      createAlert(taskId, "agent_complete", "Plan is ready for review");
      return;
    }

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
      runPostCompletionAnalysis(taskId);
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
    "plan_ready",
    "agent_done",
    "preview_live",
  ];

  const activeTasks = db
    .select()
    .from(schema.tasks)
    .where(inArray(schema.tasks.status, activeStatuses))
    .all();

  if (activeTasks.length === 0) {
    logger.info("[reconnect]", "no active tasks to reconnect");
    return;
  }

  logger.info("[reconnect]", `found ${activeTasks.length} active task(s), checking health...`);

  for (const task of activeTasks) {
    if (task.mode === "team") {
      await reconnectTeamTask(task);
    } else {
      await reconnectSoloTask(task);
    }
  }
}

async function reconnectSoloTask(task: Task): Promise<void> {
  if (!task.opencodePort) {
    logger.info("[reconnect]", `task ${task.id.slice(0, 8)} has no port, skipping`);
    return;
  }

  logger.info("[reconnect]", `task ${task.id.slice(0, 8)} checking port ${task.opencodePort}...`);
  const alive = await opencode.checkHealth(task.opencodePort);
  logger.info("[reconnect]", `task ${task.id.slice(0, 8)} health: ${alive}`);

  if (alive) {
    const mode = task.status === "agent_done" || task.status === "preview_live"
      ? "build" : "plan";
    taskAgentMode.set(task.id, mode);

    setTaskPort(task.id, task.opencodePort);
    const controller = await monitorOpenCodeEvents(
      task.opencodePort,
      task.id,
      buildEventHandler(task.id)
    );

    eventControllers.set(task.id, controller);
    logger.info("[reconnect]", `task ${task.id.slice(0, 8)} SSE reconnected (mode: ${mode})`);
  } else {
    logger.info("[reconnect]", `task ${task.id.slice(0, 8)} is dead, marking failed`);
    updateTaskError(task.id, "OpenCode process died while orchestrator was offline");
  }
}

async function reconnectTeamTask(task: Task): Promise<void> {
  const members = findTeamMembers(task.id);
  if (members.length === 0) {
    logger.info("[reconnect]", `team task ${task.id.slice(0, 8)} has no members, skipping`);
    return;
  }

  const project = requireProject(task.projectId);
  const config = project.config as AgentCoConfig | null;
  const infra: InfrastructureResult = {
    worktreePath: task.worktreePath!,
    branchName: task.branchName!,
  };

  let leaderAlive = false;

  for (const member of members) {
    if (!member.opencodePort) {
      logger.info("[reconnect]", `team member "${member.label}" has no port, skipping`);
      continue;
    }

    logger.info("[reconnect]", `team member "${member.label}" checking port ${member.opencodePort}...`);
    const alive = await opencode.checkHealth(member.opencodePort);
    logger.info("[reconnect]", `team member "${member.label}" health: ${alive}`);

    if (alive) {
      if (member.role === "leader") leaderAlive = true;

      setTaskPort(`${task.id}:${member.id}`, member.opencodePort);
      const controller = await monitorOpenCodeEvents(
        member.opencodePort,
        task.id,
        buildTeamEventHandler(task.id, member.id, member.label, infra, task, config)
      );

      eventControllers.set(`${task.id}:${member.id}`, controller);
      logger.info("[reconnect]", `team member "${member.label}" SSE reconnected`);
    } else {
      logger.info("[reconnect]", `team member "${member.label}" is dead`);
      updateTeamMemberStatus(task.id, member.id, member.label, "failed");
    }
  }

  if (!leaderAlive) {
    logger.info("[reconnect]", `team task ${task.id.slice(0, 8)} leader is dead, marking failed`);
    updateTaskError(task.id, "Team leader process died while orchestrator was offline");
  }
}

function parseModelId(modelString: string): { providerID: string; modelID: string } | undefined {
  const parts = modelString.split("/");
  if (parts.length !== 2) return undefined;
  return { providerID: parts[0], modelID: parts[1] };
}
