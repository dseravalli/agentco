import { execFileSync } from "node:child_process";
import { OPENCODE_BIN } from "@agentco/shared";

export function isTmux(): boolean {
  return !!process.env.TMUX;
}

export function openTmuxWindow(windowName: string, serverUrl: string, sessionId: string): void {
  const cmd = `exec ${OPENCODE_BIN} attach ${serverUrl} -s ${sessionId}`;
  execFileSync("tmux", ["new-window", "-n", windowName, cmd], {
    stdio: "inherit",
  });
}
