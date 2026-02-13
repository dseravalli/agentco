import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasks, projects, type Task } from "../api/client.js";

const STATUS_GROUPS = [
  { label: "Active", statuses: ["setting_up", "agent_running", "needs_input"] },
  { label: "Done", statuses: ["agent_done", "preview_live", "pr_created"] },
  { label: "Pending", statuses: ["pending"] },
  { label: "Completed", statuses: ["merged", "archived"] },
  { label: "Failed", statuses: ["failed"] },
] as const;

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-600",
  setting_up: "bg-yellow-600",
  agent_running: "bg-blue-600",
  needs_input: "bg-orange-600",
  agent_done: "bg-green-600",
  preview_live: "bg-cyan-600",
  pr_created: "bg-purple-600",
  merged: "bg-gray-500",
  archived: "bg-gray-700",
  failed: "bg-red-600",
};

interface Props {
  projectId?: string;
  onSelectTask: (taskId: string) => void;
}

export function TaskBoard({ projectId, onSelectTask }: Props) {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState({ projectId: projectId ?? "", title: "", description: "" });

  const { data: taskList = [] } = useQuery({
    queryKey: ["tasks", projectId],
    queryFn: () => tasks.list({ projectId }),
  });

  const { data: projectList = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: projects.list,
  });

  const createMutation = useMutation({
    mutationFn: tasks.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setShowCreate(false);
      setNewTask({ projectId: projectId ?? "", title: "", description: "" });
    },
  });

  const grouped = STATUS_GROUPS.map((group) => ({
    ...group,
    tasks: taskList.filter((t) =>
      (group.statuses as readonly string[]).includes(t.status ?? "pending")
    ),
  })).filter((g) => g.tasks.length > 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Tasks</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
        >
          New Task
        </button>
      </div>

      {showCreate && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(newTask);
          }}
          className="mb-4 rounded-lg border border-gray-800 bg-gray-900 p-4"
        >
          <div className="mb-3">
            <label className="mb-1 block text-sm text-gray-400">Project</label>
            <select
              value={newTask.projectId}
              onChange={(e) => setNewTask({ ...newTask, projectId: e.target.value })}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm"
              required
            >
              <option value="">Select a project...</option>
              {projectList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-sm text-gray-400">Title</label>
            <input
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm"
              placeholder="Add dark mode support"
              required
            />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-sm text-gray-400">Description</label>
            <textarea
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm"
              placeholder="Full task prompt for the agent..."
              rows={4}
              required
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {createMutation.isPending ? "Creating..." : "Create Task"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded border border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-800"
            >
              Cancel
            </button>
          </div>
          {createMutation.error && (
            <p className="mt-2 text-sm text-red-400">{String(createMutation.error)}</p>
          )}
        </form>
      )}

      {grouped.length === 0 ? (
        <p className="text-sm text-gray-500">No tasks yet.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 text-sm font-medium text-gray-400">{group.label}</h3>
              <div className="space-y-2">
                {group.tasks.map((task) => (
                  <TaskCard key={task.id} task={task} onClick={() => onSelectTask(task.id)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg border border-gray-800 bg-gray-900 p-3 transition hover:border-gray-700"
    >
      <div className="flex items-start justify-between">
        <div>
          <h4 className="text-sm font-medium">{task.title}</h4>
          <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">
            {task.description}
          </p>
        </div>
        <span
          className={`ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[task.status ?? "pending"] ?? "bg-gray-600"}`}
        >
          {task.status ?? "pending"}
        </span>
      </div>
      {task.error && (
        <p className="mt-1 text-xs text-red-400 line-clamp-1">{task.error}</p>
      )}
    </div>
  );
}
