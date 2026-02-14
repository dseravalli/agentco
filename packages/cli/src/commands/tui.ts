import { Command } from "commander";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function registerTuiCommand(program: Command): void {
  program
    .command("tui")
    .description("Launch the interactive terminal UI dashboard")
    .action(() => {
      // __dirname is packages/cli/src/commands (dev) or packages/cli/dist/commands (built)
      // Go up to packages/ then into tui/
      const tuiDir = resolve(__dirname, "../../../tui");

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
