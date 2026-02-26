import { execFileSync } from "node:child_process";
import { OPENCODE_BIN } from "@agentco/shared";

export function assertTmux(): void {
  if (!process.env.TMUX) {
    console.error("Error: Not inside a tmux session. Run this command from within tmux.");
    process.exit(1);
  }
}

export function openTmuxWindow(windowName: string, serverUrl: string, sessionId: string): void {
  // Use exec so the shell is replaced by opencode — when the pane
  // closes, SIGHUP goes directly to the opencode process instead of
  // a wrapper shell that may not forward it.
  const cmd = `exec ${OPENCODE_BIN} attach ${serverUrl} -s ${sessionId}`;
  execFileSync("tmux", ["new-window", "-n", windowName, cmd], {
    stdio: "inherit",
  });
}
