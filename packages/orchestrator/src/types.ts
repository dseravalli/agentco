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
  | "preview_live"
  | "pr_created"
  | "error";

export interface AgentCoConfig {
  copyOnWorktree?: string[];
  envOverrides?: Record<string, string>;
  database?: {
    type: "postgres" | "none";
    connectionString: string;
    migrateCommand?: string;
    seedCommand?: string;
  };
  devPreview?: {
    command: string;
    portEnvVar?: string;
    healthCheck?: string;
    readyPattern?: string;
  };
  agent?: {
    defaultModel?: string;
    defaultAgent?: string;
    planMode?: boolean;
  };
}

export type WSEvent =
  | { type: "task:status_changed"; taskId: string; status: TaskStatus }
  | { type: "task:title_changed"; taskId: string; title: string }
  | { type: "task:alert"; taskId: string; alert: AlertPayload }
  | { type: "task:log"; taskId: string; message: string }
  | { type: "agent:event"; taskId: string; event: unknown };

export interface AlertPayload {
  id: string;
  taskId: string;
  type: AlertType;
  message: string;
  metadata?: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

export interface PortRanges {
  opencode: { min: number; max: number };
  devPreview: { min: number; max: number };
}

export const PORT_RANGES: PortRanges = {
  opencode: { min: 4100, max: 4199 },
  devPreview: { min: 5100, max: 5199 },
};

export const ORCHESTRATOR_PORT = 8080;
