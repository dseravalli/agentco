import { Command } from "commander";
import { resolve } from "node:path";
import * as client from "../client.js";

export function registerProjectCommands(program: Command) {
  const project = program.command("project").description("Manage projects");

  project
    .command("create <name>")
    .description("Register a project with the orchestrator")
    .option("-p, --path <path>", "Project root path (defaults to cwd)")
    .action(async (name: string, opts: { path?: string }) => {
      const rootPath = resolve(opts.path || process.cwd());
      try {
        const result = await client.createProject(name, rootPath);
        console.log(`Project created: ${result.name} (${result.id.slice(0, 8)})`);
        console.log(`  Root: ${result.rootPath}`);
        console.log(`  Slug: ${result.slug}`);
      } catch (err) {
        console.error(`Failed to create project: ${(err as Error).message}`);
        process.exit(1);
      }
    });

  project
    .command("list")
    .description("List all registered projects")
    .action(async () => {
      try {
        const projects = await client.listProjects();
        if (projects.length === 0) {
          console.log("No projects registered.");
          return;
        }
        const header = padRow("ID", "Name", "Slug", "Root Path");
        console.log(header);
        console.log("─".repeat(header.length));
        for (const p of projects) {
          console.log(padRow(p.id.slice(0, 8), p.name, p.slug, p.rootPath));
        }
      } catch (err) {
        console.error(`Failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
  project
    .command("delete <name>")
    .description("Delete a registered project")
    .action(async (name: string) => {
      try {
        const proj = await client.findProjectByName(name);
        if (!proj) {
          console.error(`Project not found: ${name}`);
          process.exit(1);
        }
        await client.deleteProject(proj.id);
        console.log(`Deleted project: ${proj.name} (${proj.id.slice(0, 8)})`);
      } catch (err) {
        console.error(`Failed to delete project: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}

function padRow(...cols: string[]): string {
  const widths = [10, 20, 20, 50];
  return cols.map((col, i) => col.padEnd(widths[i] || 20)).join(" ");
}
