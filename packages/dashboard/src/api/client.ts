const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Types matching the orchestrator schema
export interface Project {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  config: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Task {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  description: string;
  status: string;
  branchName: string | null;
  worktreePath: string | null;
  opencodePort: number | null;
  opencodeSessionId: string | null;
  devPreviewPort: number | null;
  databaseName: string | null;
  prUrl: string | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Alert {
  id: string;
  taskId: string;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  read: boolean | null;
  createdAt: string | null;
}

// Projects
export const projects = {
  list: () => request<Project[]>("/projects"),
  get: (id: string) => request<Project>(`/projects/${id}`),
  create: (data: { name: string; rootPath: string }) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  sync: (id: string) =>
    request<Project>(`/projects/${id}/sync`, { method: "POST" }),
};

// Tasks
export const tasks = {
  list: (params?: { projectId?: string; status?: string }) => {
    const search = new URLSearchParams();
    if (params?.projectId) search.set("projectId", params.projectId);
    if (params?.status) search.set("status", params.status);
    const qs = search.toString();
    return request<Task[]>(`/tasks${qs ? `?${qs}` : ""}`);
  },
  get: (id: string) => request<Task>(`/tasks/${id}`),
  create: (data: { projectId: string; title: string; description: string }) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(data) }),
  start: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}/start`, { method: "POST" }),
  abort: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}/abort`, { method: "POST" }),
  retry: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}/retry`, { method: "POST" }),
  pr: (id: string) =>
    request<{ ok: boolean; prUrl: string }>(`/tasks/${id}/pr`, { method: "POST" }),
  preview: (id: string) =>
    request<{ ok: boolean; previewUrl: string | null }>(`/tasks/${id}/preview`, { method: "POST" }),
  cleanup: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}/cleanup`, { method: "POST" }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}`, { method: "DELETE" }),
};

// Alerts
export const alerts = {
  list: (params?: { taskId?: string; unread?: boolean }) => {
    const search = new URLSearchParams();
    if (params?.taskId) search.set("taskId", params.taskId);
    if (params?.unread) search.set("unread", "true");
    const qs = search.toString();
    return request<Alert[]>(`/alerts${qs ? `?${qs}` : ""}`);
  },
  markRead: (id: string) =>
    request<{ ok: boolean }>(`/alerts/${id}/read`, { method: "POST" }),
  respond: (id: string, data: { action: "approve" | "deny"; answers?: string[][] }) =>
    request<{ ok: boolean }>(`/alerts/${id}/respond`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
