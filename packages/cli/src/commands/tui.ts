import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export function registerTuiCommand(program: Command): void {
  program
    .command("tui")
    .description("Launch the interactive terminal UI dashboard")
    .action(() => {
      // import.meta.dir is packages/cli/src/commands
      // Go up to packages/ then into tui/
      const tuiDir = resolve(import.meta.dir, "../../../tui");

      try {
        execFileSync("bun", ["run", "src/index.tsx"], {
          cwd: tuiDir,
          stdio: "inherit",
          env: {
            ...process.env,
            AGENTCO_URL: process.env.AGENTCO_URL || "http://localhost:8080",
          },
        });
      } catch (err: unknown) {
        const exitErr = err as { status?: number };
        if (exitErr.status !== null && exitErr.status !== undefined) {
          process.exit(exitErr.status);
        }
        throw err;
      }
    });
}
