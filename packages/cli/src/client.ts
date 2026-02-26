import type { Project, Task } from "@agentco/shared";

export type { Project, Task };

const BASE_URL = process.env.AGENTCO_URL || "http://localhost:8080";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });
  } catch (err) {
    throw new Error(
      `Cannot connect to orchestrator at ${BASE_URL}. Is it running?\n  ${(err as Error).message}`,
      { cause: err },
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export async function listProjects(): Promise<Project[]> {
  return request("/api/projects");
}

export async function createProject(name: string, rootPath: string): Promise<Project> {
  return request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, rootPath }),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await request(`/api/projects/${id}`, { method: "DELETE" });
}

export async function findProjectByName(name: string): Promise<Project | undefined> {
  const projects = await listProjects();
  const lower = name.toLowerCase();
  return projects.find((p) => p.name.toLowerCase() === lower || p.slug === lower);
}

export async function listTasks(projectId?: string): Promise<Task[]> {
  const params = projectId ? `?projectId=${projectId}` : "";
  return request(`/api/tasks${params}`);
}

export async function createTask(projectId: string, description: string): Promise<Task> {
  return request("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ projectId, description }),
  });
}

export async function startTask(taskId: string): Promise<void> {
  await request(`/api/tasks/${taskId}/start`, { method: "POST" });
}

export async function getTask(taskId: string): Promise<Task> {
  return request(`/api/tasks/${taskId}`);
}

export async function abortTask(taskId: string): Promise<void> {
  await request(`/api/tasks/${taskId}/abort`, { method: "POST" });
}

export async function cleanupTask(taskId: string): Promise<void> {
  await request(`/api/tasks/${taskId}/cleanup`, { method: "POST" });
}

export async function deleteTask(taskId: string): Promise<void> {
  await request(`/api/tasks/${taskId}`, { method: "DELETE" });
}
