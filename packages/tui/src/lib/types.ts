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
  | "aborted"

export type AlertType =
  | "needs_permission"
  | "needs_input"
  | "needs_question"
  | "agent_complete"
  | "preview_live"
  | "pr_created"
  | "error"

export interface Project {
  id: string
  name: string
  slug: string
  rootPath: string
  config: unknown
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  projectId: string
  slug: string
  title: string
  description: string
  status: TaskStatus
  branchName: string | null
  worktreePath: string | null
  opencodePort: number | null
  opencodeSessionId: string | null
  devPreviewPort: number | null
  databaseName: string | null
  prUrl: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface Alert {
  id: string
  taskId: string
  type: AlertType
  message: string
  metadata: Record<string, unknown> | null
  read: boolean
  createdAt: string
}

export type WSEvent =
  | { type: "task:status_changed"; taskId: string; status: TaskStatus }
  | { type: "task:alert"; taskId: string; alert: Alert }
  | { type: "task:log"; taskId: string; message: string }
  | { type: "agent:event"; taskId: string; event: unknown }
