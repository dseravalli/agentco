import { useState, useEffect } from "react";
import { ProjectList } from "./components/ProjectList.js";
import { TaskBoard } from "./components/TaskBoard.js";
import { TaskDetail } from "./components/TaskDetail.js";
import { AlertPanel } from "./components/AlertPanel.js";
import { useWebSocket, WSProvider } from "./hooks/useWebSocket.js";

function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission>(
    "Notification" in window ? Notification.permission : "denied"
  );

  useEffect(() => {
    if (!("Notification" in window)) return;
    setPermission(Notification.permission);
  }, []);

  const request = () => {
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(setPermission);
  };

  return { permission, request };
}

type View =
  | { type: "projects" }
  | { type: "tasks"; projectId?: string }
  | { type: "task"; taskId: string };

export function App() {
  const [view, setView] = useState<View>({ type: "tasks" });
  const { connected } = useWebSocket();
  const notifications = useNotificationPermission();

  return (
    <WSProvider value={connected}>
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <h1
            className="cursor-pointer text-xl font-bold tracking-tight"
            onClick={() => setView({ type: "tasks" })}
          >
            AgentCo
          </h1>
          <nav className="flex items-center gap-4">
            <button
              onClick={() => setView({ type: "projects" })}
              className={`text-sm ${view.type === "projects" ? "text-white" : "text-gray-400 hover:text-gray-200"}`}
            >
              Projects
            </button>
            <button
              onClick={() => setView({ type: "tasks" })}
              className={`text-sm ${view.type === "tasks" ? "text-white" : "text-gray-400 hover:text-gray-200"}`}
            >
              Tasks
            </button>
            {notifications.permission === "default" && (
              <button
                onClick={notifications.request}
                className="rounded bg-yellow-700 px-2 py-1 text-xs text-yellow-100 hover:bg-yellow-600"
              >
                Enable Notifications
              </button>
            )}
            {notifications.permission === "granted" && (
              <button
                onClick={() => new Notification("AgentCo — Test", { body: "Notifications are working!" })}
                className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 hover:bg-gray-600"
              >
                Test Notification
              </button>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span
                className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
              />
              {connected ? "Connected" : "Disconnected"}
            </div>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 p-4">
        <main className="min-w-0 flex-1">
          {view.type === "projects" && (
            <ProjectList
              onSelectProject={(projectId) =>
                setView({ type: "tasks", projectId })
              }
            />
          )}
          {view.type === "tasks" && (
            <TaskBoard
              projectId={view.projectId}
              onSelectTask={(taskId) => setView({ type: "task", taskId })}
            />
          )}
          {view.type === "task" && (
            <TaskDetail
              taskId={view.taskId}
              onBack={() => setView({ type: "tasks" })}
            />
          )}
        </main>
        <aside className="w-80 shrink-0">
          <AlertPanel
            onViewTask={(taskId) => setView({ type: "task", taskId })}
          />
        </aside>
      </div>
    </div>
    </WSProvider>
  );
}
