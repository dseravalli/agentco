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

export interface TeamPaneMember {
  serverUrl: string;
  sessionId: string;
  label: string;
}

export function openTeamTmuxLayout(windowName: string, members: TeamPaneMember[]): void {
  if (members.length === 0) return;

  const leader = members[0];
  const workers = members.slice(1);

  const leaderCmd = `exec ${OPENCODE_BIN} attach ${leader.serverUrl} -s ${leader.sessionId}`;
  execFileSync("tmux", ["new-window", "-n", windowName, leaderCmd], {
    stdio: "inherit",
  });

  for (const worker of workers) {
    const cmd = `exec ${OPENCODE_BIN} attach ${worker.serverUrl} -s ${worker.sessionId}`;
    execFileSync("tmux", ["split-window", "-h", "-t", windowName, cmd], {
      stdio: "inherit",
    });
  }

  execFileSync("tmux", ["select-layout", "-t", windowName, "main-vertical"], {
    stdio: "inherit",
  });

  execFileSync("tmux", ["select-pane", "-t", `${windowName}.0`], {
    stdio: "inherit",
  });
}
