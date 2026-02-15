import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as client from "../client.js";
import { assertTmux, openTmuxWindow } from "../utils/tmux.js";

export function registerTaskCommands(program: Command) {
  const task = program.command("task").description("Manage tasks");

  task
    .command("create <project> [description]")
    .description("Create and start a new task")
    .option("-f, --file <path>", "Read task description from a markdown file")
    .action(
      async (
        projectName: string,
        description: string | undefined,
        opts: { file?: string }
      ) => {
        try {
          let taskDescription: string;
          if (opts.file) {
            taskDescription = await readFile(resolve(opts.file), "utf-8");
          } else if (description) {
            taskDescription = description;
          } else {
            console.error(
              "Error: Provide a description argument or use --file <path>"
            );
            process.exit(1);
          }

          const project = await client.findProjectByName(projectName);
          if (!project) {
            console.error(
              `Project "${projectName}" not found. Register it first with: agentco project create`
            );
            process.exit(1);
          }

          const result = await client.createTask(
            project.id,
            taskDescription
          );
          console.log(
            `Task created: ${result.title} (${result.id.slice(0, 8)})`
          );

          console.log("Starting task...");
          await client.startTask(result.id);
          console.log("Task started.");
          console.log(`  ID:     ${result.id.slice(0, 8)}`);
          console.log(`  Slug:   ${result.slug}`);
          console.log(`  Attach: agentco task attach ${result.id.slice(0, 8)}`);
        } catch (err) {
          console.error(`Failed: ${(err as Error).message}`);
          process.exit(1);
        }
      }
    );

  task
    .command("list")
    .description("List all tasks and their status")
    .option("-p, --project <name>", "Filter by project name")
    .action(async (opts: { project?: string }) => {
      try {
        let projectId: string | undefined;
        if (opts.project) {
          const project = await client.findProjectByName(opts.project);
          if (!project) {
            console.error(`Project "${opts.project}" not found.`);
            process.exit(1);
          }
          projectId = project.id;
        }

        const tasks = await client.listTasks(projectId);
        if (tasks.length === 0) {
          console.log("No tasks found.");
          return;
        }

        const projects = await client.listProjects();
        const projectMap = new Map(projects.map((p) => [p.id, p.name]));

        const header = padRow(
          "ID",
          "Project",
          "Title",
          "Status",
          "Branch",
          "Port"
        );
        console.log(header);
        console.log("─".repeat(header.length));

        for (const t of tasks) {
          console.log(
            padRow(
              t.id.slice(0, 8),
              projectMap.get(t.projectId) || "?",
              truncate(t.title, 30),
              t.status,
              t.branchName || "—",
              t.opencodePort ? String(t.opencodePort) : "—"
            )
          );
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("attach <taskId>")
    .description(
      "Attach an opencode TUI to a running task (requires tmux)"
    )
    .action(async (taskId: string) => {
      try {
        assertTmux();

        // Support short IDs via prefix match
        const tasks = await client.listTasks();
        const match = tasks.find((t) => t.id.startsWith(taskId));
        if (!match) {
          console.error(`Task "${taskId}" not found.`);
          process.exit(1);
        }

        const attachable = [
          "agent_running",
          "needs_input",
          "agent_done",
          "preview_live",
        ];
        if (!attachable.includes(match.status)) {
          console.error(
            `Task is "${match.status}". Can only attach when: ${attachable.join(", ")}`
          );
          process.exit(1);
        }

        if (!match.opencodePort || !match.opencodeSessionId) {
          console.error("Task has no opencode session to attach to.");
          process.exit(1);
        }

        const url = `http://127.0.0.1:${match.opencodePort}`;
        console.log(
          `Attaching to "${match.title}" (port ${match.opencodePort})...`
        );
        openTmuxWindow(
          `oc-${match.slug}`,
          url,
          match.opencodeSessionId
        );
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  task
    .command("kill <taskId>")
    .description("Abort the agent, clean up resources, and delete a task")
    .action(async (taskId: string) => {
      try {
        const tasks = await client.listTasks();
        const match = tasks.find((t) => t.id.startsWith(taskId));
        if (!match) {
          console.error(`Task "${taskId}" not found.`);
          process.exit(1);
        }

        const active = [
          "setting_up",
          "agent_running",
          "needs_input",
          "agent_done",
          "preview_live",
        ];

        if (active.includes(match.status)) {
          console.log(`Aborting agent...`);
          await client.abortTask(match.id).catch(() => {});
          console.log(`Cleaning up worktree, database, and processes...`);
          await client.cleanupTask(match.id);
        }

        console.log(`Deleting task...`);
        await client.deleteTask(match.id);
        console.log(`Task "${match.title}" (${match.id.slice(0, 8)}) killed.`);
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function padRow(...cols: string[]): string {
  const widths = [10, 14, 32, 16, 34, 6];
  return cols.map((col, i) => col.padEnd(widths[i] || 20)).join(" ");
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
