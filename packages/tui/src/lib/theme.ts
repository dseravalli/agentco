import type { TaskStatus } from "./types.js"

export const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "#888",
  setting_up: "#d19a66",
  agent_running: "#61afef",
  needs_input: "#e5c07b",
  plan_ready: "#c678dd",
  agent_done: "#98c379",
  preview_live: "#c678dd",
  pr_created: "#56b6c2",
  merged: "#98c379",
  archived: "#555",
  failed: "#e06c75",
  aborted: "#d19a66",
}

export const STATUS_LABELS: Record<TaskStatus, string> = {
  pending: "Pending",
  setting_up: "Setting Up",
  agent_running: "Agent Running",
  needs_input: "Needs Input",
  plan_ready: "Plan Ready",
  agent_done: "Agent Done",
  preview_live: "Preview Live",
  pr_created: "PR Created",
  merged: "Merged",
  archived: "Archived",
  failed: "Failed",
  aborted: "Aborted",
}

export function statusColor(status: string): string {
  return STATUS_COLORS[status as TaskStatus] || "#888"
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status as TaskStatus] || status
}

export const colors = {
  border: "#666",
  bg: "#333",
  text: "#ccc",
  textDim: "#888",
  textMuted: "#555",
  accent: "#61afef",
  warning: "#e5c07b",
  error: "#e06c75",
  success: "#98c379",
  highlight: "#2c313c",
  highlightText: "#fff",
  key: "#ccc",
  keyLabel: "#555",
} as const
