import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projects } from "../api/client.js";

interface Props {
  onSelectProject: (projectId: string) => void;
}

export function ProjectList({ onSelectProject }: Props) {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");

  const { data: projectList = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: projects.list,
  });

  const createMutation = useMutation({
    mutationFn: projects.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setShowAdd(false);
      setName("");
      setRootPath("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: projects.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const syncMutation = useMutation({
    mutationFn: projects.sync,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
        >
          Register Project
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate({ name, rootPath });
          }}
          className="mb-4 rounded-lg border border-gray-800 bg-gray-900 p-4"
        >
          <div className="mb-3">
            <label className="mb-1 block text-sm text-gray-400">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm"
              placeholder="my-project"
              required
            />
          </div>
          <div className="mb-3">
            <label className="mb-1 block text-sm text-gray-400">Root Path</label>
            <input
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-mono"
              placeholder="/Users/you/projects/my-project"
              required
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500 disabled:opacity-50"
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
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

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : projectList.length === 0 ? (
        <p className="text-sm text-gray-500">No projects registered yet.</p>
      ) : (
        <div className="space-y-2">
          {projectList.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 p-4"
            >
              <div
                className="cursor-pointer"
                onClick={() => onSelectProject(p.id)}
              >
                <h3 className="font-medium">{p.name}</h3>
                <p className="text-sm font-mono text-gray-500">{p.rootPath}</p>
                {p.config && (
                  <p className="mt-1 text-xs text-gray-600">
                    .agentco.json loaded
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => syncMutation.mutate(p.id)}
                  className="rounded border border-gray-700 px-2 py-1 text-xs hover:bg-gray-800"
                >
                  Sync Config
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete project "${p.name}"?`)) {
                      deleteMutation.mutate(p.id);
                    }
                  }}
                  className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:bg-red-950"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
