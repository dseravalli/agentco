import { execFileSync } from "node:child_process";
import { OPENCODE_BIN } from "@agentco/shared";

export function assertTmux(): void {
  if (!process.env.TMUX) {
    console.error("Error: Not inside a tmux session. Run this command from within tmux.");
    process.exit(1);
  }
}

export function openTmuxWindow(
  windowName: string,
  serverUrl: string,
  sessionId: string
): void {
  // Use exec so the shell is replaced by opencode — when the pane
  // closes, SIGHUP goes directly to the opencode process instead of
  // a wrapper shell that may not forward it.
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

export function openTeamTmuxLayout(
  windowName: string,
  members: TeamPaneMember[]
): void {
  if (members.length === 0) return;

  const leader = members[0];
  const workers = members.slice(1);

  // Create window with leader in the first pane
  const leaderCmd = `exec ${OPENCODE_BIN} attach ${leader.serverUrl} -s ${leader.sessionId}`;
  execFileSync("tmux", ["new-window", "-n", windowName, leaderCmd], {
    stdio: "inherit",
  });

  // Split each worker into the window
  for (const worker of workers) {
    const cmd = `exec ${OPENCODE_BIN} attach ${worker.serverUrl} -s ${worker.sessionId}`;
    execFileSync("tmux", ["split-window", "-h", "-t", windowName, cmd], {
      stdio: "inherit",
    });
  }

  // main-vertical: leader full-height left, workers stacked right
  execFileSync("tmux", ["select-layout", "-t", windowName, "main-vertical"], {
    stdio: "inherit",
  });

  // Focus the leader pane
  execFileSync("tmux", ["select-pane", "-t", `${windowName}.0`], {
    stdio: "inherit",
  });
}
