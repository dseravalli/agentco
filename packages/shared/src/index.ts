// Binary path
export const OPENCODE_BIN = "/Users/dseravalli/.local/bin/opencode-patched";

// Enums / unions

export type TaskStatus =
  | "pending"
  | "setting_up"
  | "agent_running"
  | "needs_input"
  | "plan_ready"
  | "agent_done"
  | "preview_live"
  | "pr_created"
  | "merged"
  | "archived"
  | "failed"
  | "aborted";

export type AlertType =
  | "needs_permission"
  | "needs_input"
  | "needs_question"
  | "agent_complete"
  | "action_required"
  | "preview_live"
  | "pr_created"
  | "error";

// Constants

export interface PortRanges {
  opencode: { min: number; max: number };
  devPreview: { min: number; max: number };
}

export const PORT_RANGES: PortRanges = {
  opencode: { min: 4100, max: 4199 },
  devPreview: { min: 5100, max: 5199 },
};

export const ORCHESTRATOR_PORT = 8080;

// Entity interfaces

export interface Project {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  description: string;
  model: string | null;
  status: TaskStatus;
  branchName: string | null;
  worktreePath: string | null;
  opencodePort: number | null;
  opencodeSessionId: string | null;
  devPreviewPort: number | null;
  databaseName: string | null;
  prUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  taskId: string;
  type: AlertType;
  message: string;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

// WebSocket events

export type WSEvent =
  | { type: "task:status_changed"; taskId: string; status: TaskStatus }
  | { type: "task:title_changed"; taskId: string; title: string }
  | { type: "task:alert"; taskId: string; alert: Alert }
  | { type: "task:log"; taskId: string; message: string }
  | { type: "agent:event"; taskId: string; event: unknown };
