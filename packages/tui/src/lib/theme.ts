import type { TaskStatus } from "./types.js"

export const STATUS_COLORS: Record<TaskStatus, string> = {
  pending: "#888",
  setting_up: "#d19a66",
  agent_running: "#61afef",
  needs_input: "#e5c07b",
  agent_done: "#98c379",
  preview_live: "#c678dd",
  pr_created: "#56b6c2",
  merged: "#98c379",
  archived: "#555",
  failed: "#e06c75",
}

export function statusColor(status: string): string {
  return STATUS_COLORS[status as TaskStatus] || "#888"
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
