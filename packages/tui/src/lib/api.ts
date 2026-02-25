import type { Project, Task, TaskMode, Alert, TeamMember } from "./types.js";

export class ApiClient {
  constructor(private baseUrl: string) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API error ${res.status}: ${body}`);
    }

    return res.json();
  }

  // Projects

  async listProjects(): Promise<Project[]> {
    return this.request("/api/projects");
  }

  async getProject(id: string): Promise<Project> {
    return this.request(`/api/projects/${id}`);
  }

  // Tasks

  async listTasks(projectId?: string, status?: string): Promise<Task[]> {
    const params = new URLSearchParams();
    if (projectId) params.set("projectId", projectId);
    if (status) params.set("status", status);
    const qs = params.toString();
    return this.request(`/api/tasks${qs ? `?${qs}` : ""}`);
  }

  async getTask(id: string): Promise<Task> {
    return this.request(`/api/tasks/${id}`);
  }

  async createTask(
    projectId: string,
    description: string,
    model?: string,
    mode?: TaskMode,
  ): Promise<Task> {
    return this.request("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ projectId, description, model, mode }),
    });
  }

  async listTeamMembers(taskId: string): Promise<TeamMember[]> {
    return this.request(`/api/tasks/${taskId}/members`);
  }

  async listModels(): Promise<string[]> {
    return this.request("/api/config/models");
  }

  async startTask(id: string): Promise<void> {
    await this.request(`/api/tasks/${id}/start`, { method: "POST" });
  }

  async abortTask(id: string): Promise<void> {
    await this.request(`/api/tasks/${id}/abort`, { method: "POST" });
  }

  async retryTask(id: string): Promise<void> {
    await this.request(`/api/tasks/${id}/retry`, { method: "POST" });
  }

  async createPR(id: string): Promise<{ ok: true; prUrl: string }> {
    return this.request(`/api/tasks/${id}/pr`, { method: "POST" });
  }

  async startPreview(id: string): Promise<{ ok: true; previewUrl: string }> {
    return this.request(`/api/tasks/${id}/preview`, { method: "POST" });
  }

  async cleanupTask(id: string): Promise<void> {
    await this.request(`/api/tasks/${id}/cleanup`, { method: "POST" });
  }

  async deleteTask(id: string): Promise<void> {
    await this.request(`/api/tasks/${id}`, { method: "DELETE" });
  }

  // Alerts

  async listAlerts(taskId?: string, unread?: boolean): Promise<Alert[]> {
    const params = new URLSearchParams();
    if (taskId) params.set("taskId", taskId);
    if (unread !== undefined) params.set("unread", String(unread));
    const qs = params.toString();
    return this.request(`/api/alerts${qs ? `?${qs}` : ""}`);
  }

  async markAlertRead(id: string): Promise<void> {
    await this.request(`/api/alerts/${id}/read`, { method: "POST" });
  }
}
