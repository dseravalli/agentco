import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tasks, alerts as alertsApi, type Task, type Alert } from "../api/client.js";
import { useWSConnected } from "../hooks/useWebSocket.js";

interface Props {
  taskId: string;
  onBack: () => void;
}

function buildAgentUrl(task: Task): string | null {
  if (!task.opencodePort) return null;
  const base = `http://localhost:${task.opencodePort}`;
  if (!task.worktreePath || !task.opencodeSessionId) return base;
  const slug = btoa(task.worktreePath)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  return `${base}/${slug}/session/${task.opencodeSessionId}`;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  setting_up: "Setting Up",
  agent_running: "Agent Running",
  needs_input: "Needs Input",
  agent_done: "Agent Done",
  preview_live: "Preview Live",
  pr_created: "PR Created",
  merged: "Merged",
  archived: "Archived",
  failed: "Failed",
};

export function TaskDetail({ taskId, onBack }: Props) {
  const queryClient = useQueryClient();
  const wsConnected = useWSConnected();
  const fallbackPoll = wsConnected ? false : 5000;

  const { data: task } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => tasks.get(taskId),
    refetchInterval: fallbackPoll,
  });

  const { data: taskAlerts = [] } = useQuery({
    queryKey: ["alerts", taskId],
    queryFn: () => alertsApi.list({ taskId }),
    refetchInterval: fallbackPoll,
  });

  const startMutation = useMutation({
    mutationFn: () => tasks.start(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const abortMutation = useMutation({
    mutationFn: () => tasks.abort(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const retryMutation = useMutation({
    mutationFn: () => tasks.retry(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const prMutation = useMutation({
    mutationFn: () => tasks.pr(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const previewMutation = useMutation({
    mutationFn: () => tasks.preview(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const cleanupMutation = useMutation({
    mutationFn: () => tasks.cleanup(taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  });

  const respondMutation = useMutation({
    mutationFn: ({ alertId, action, answers }: {
      alertId: string;
      action: "approve" | "deny";
      answers?: string[][];
    }) => alertsApi.respond(alertId, { action, answers }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    },
  });

  if (!task) return <p className="text-sm text-gray-500">Loading...</p>;

  const status = task.status ?? "pending";

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-4 text-sm text-gray-400 hover:text-gray-200"
      >
        &larr; Back to Tasks
      </button>

      <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">{task.title}</h2>
            <p className="mt-1 text-sm text-gray-400">{task.description}</p>
          </div>
          <span className="rounded-full bg-gray-800 px-3 py-1 text-sm font-medium">
            {STATUS_LABELS[status] ?? status}
          </span>
        </div>

        {task.error && (
          <div className="mt-4 rounded border border-red-900 bg-red-950 p-3 text-sm text-red-300">
            {task.error}
          </div>
        )}

        {/* Metadata */}
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          {task.branchName && (
            <div>
              <span className="text-gray-500">Branch: </span>
              <span className="font-mono">{task.branchName}</span>
            </div>
          )}
          {task.opencodePort && (
            <div>
              <span className="text-gray-500">OpenCode: </span>
              <span className="font-mono">:{task.opencodePort}</span>
            </div>
          )}
          {task.devPreviewPort && (
            <div>
              <span className="text-gray-500">Preview: </span>
              <span className="font-mono">:{task.devPreviewPort}</span>
            </div>
          )}
          {task.databaseName && (
            <div>
              <span className="text-gray-500">Database: </span>
              <span className="font-mono">{task.databaseName}</span>
            </div>
          )}
          {task.prUrl && (
            <div className="col-span-2">
              <span className="text-gray-500">PR: </span>
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 underline hover:text-blue-300"
              >
                {task.prUrl}
              </a>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap gap-2">
          {status === "pending" && (
            <ActionButton onClick={() => startMutation.mutate()} pending={startMutation.isPending}>
              Start Task
            </ActionButton>
          )}
          {(status === "agent_running" || status === "needs_input") && (
            <ActionButton onClick={() => abortMutation.mutate()} pending={abortMutation.isPending} variant="danger">
              Abort
            </ActionButton>
          )}
          {status === "failed" && (
            <ActionButton onClick={() => retryMutation.mutate()} pending={retryMutation.isPending}>
              Retry
            </ActionButton>
          )}
          {status === "agent_done" && (
            <>
              <ActionButton onClick={() => previewMutation.mutate()} pending={previewMutation.isPending}>
                Start Preview
              </ActionButton>
              <ActionButton onClick={() => prMutation.mutate()} pending={prMutation.isPending}>
                Create PR
              </ActionButton>
            </>
          )}
          {(status === "pr_created" || status === "preview_live" || status === "merged") && (
            <ActionButton onClick={() => cleanupMutation.mutate()} pending={cleanupMutation.isPending} variant="danger">
              Cleanup
            </ActionButton>
          )}
        </div>

        {/* Links */}
        <div className="mt-4 flex gap-3">
          {buildAgentUrl(task) && (
            <a
              href={buildAgentUrl(task)!}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              Open Agent UI
            </a>
          )}
          {task.devPreviewPort && (
            <a
              href={`http://localhost:${task.devPreviewPort}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-cyan-400 hover:text-cyan-300"
            >
              Open Dev Preview
            </a>
          )}
        </div>
      </div>

      {/* Alerts for this task */}
      {taskAlerts.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-400">Alerts</h3>
          <div className="space-y-2">
            {taskAlerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onRespond={(action, answers) =>
                  respondMutation.mutate({ alertId: alert.id, action, answers })
                }
                isPending={respondMutation.isPending}
              />
            ))}
          </div>
        </div>
      )}

      {/* Agent embed */}
      {buildAgentUrl(task) && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium text-gray-400">Agent Session</h3>
          <iframe
            src={buildAgentUrl(task)!}
            className="h-[600px] w-full rounded-lg border border-gray-800"
            title="OpenCode Agent"
          />
        </div>
      )}
    </div>
  );
}

function ActionButton({
  onClick,
  pending,
  variant = "primary",
  children,
}: {
  onClick: () => void;
  pending: boolean;
  variant?: "primary" | "danger";
  children: React.ReactNode;
}) {
  const base = "rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50";
  const styles =
    variant === "danger"
      ? `${base} border border-red-800 text-red-400 hover:bg-red-950`
      : `${base} bg-blue-600 hover:bg-blue-500`;

  return (
    <button onClick={onClick} disabled={pending} className={styles}>
      {pending ? "..." : children}
    </button>
  );
}

interface QuestionSubItem {
  question: string;
  header: string;
  multiple?: boolean;
  options: Array<{ label: string; description: string }>;
}

function AlertRow({
  alert,
  onRespond,
  isPending,
}: {
  alert: Alert;
  onRespond: (action: "approve" | "deny", answers?: string[][]) => void;
  isPending: boolean;
}) {
  const metadata = alert.metadata as Record<string, unknown> | null;
  const isQuestion = alert.type === "needs_question" && !alert.read;
  const isPermission = !alert.read &&
    (alert.type === "needs_permission" || alert.type === "needs_input");
  const questions = (metadata?.questions ?? []) as QuestionSubItem[];

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        alert.read
          ? "border-gray-800 bg-gray-900 text-gray-500"
          : "border-yellow-800 bg-gray-900 text-gray-300"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <span className="mr-2 text-xs font-medium uppercase text-gray-500">
            {alert.type}
          </span>
          {alert.message}
        </div>
        {isPermission && (
          <div className="ml-3 flex gap-1">
            <button
              onClick={() => onRespond("approve")}
              disabled={isPending}
              className="rounded bg-green-700 px-2 py-0.5 text-xs hover:bg-green-600 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => onRespond("deny")}
              disabled={isPending}
              className="rounded bg-red-800 px-2 py-0.5 text-xs hover:bg-red-700 disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        )}
      </div>

      {isQuestion && questions.length > 0 && (
        <QuestionForm
          questions={questions}
          onSubmit={(answers) => onRespond("approve", answers)}
          isPending={isPending}
        />
      )}
    </div>
  );
}

function QuestionForm({
  questions,
  onSubmit,
  isPending,
}: {
  questions: QuestionSubItem[];
  onSubmit: (answers: string[][]) => void;
  isPending: boolean;
}) {
  const [selections, setSelections] = useState<string[][]>(
    () => questions.map(() => [])
  );

  function toggleOption(qIndex: number, label: string, multiple?: boolean) {
    setSelections((prev) => {
      const next = [...prev];
      const current = next[qIndex];
      if (multiple) {
        next[qIndex] = current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label];
      } else {
        next[qIndex] = [label];
      }
      return next;
    });
  }

  const allAnswered = selections.every((s) => s.length > 0);

  return (
    <div className="mt-3 space-y-4">
      {questions.map((q, qi) => (
        <div key={qi}>
          <p className="mb-1 text-xs font-medium text-gray-400">
            {q.header}: {q.question}
          </p>
          <div className="flex flex-wrap gap-1">
            {q.options.map((opt) => {
              const selected = selections[qi].includes(opt.label);
              return (
                <button
                  key={opt.label}
                  onClick={() => toggleOption(qi, opt.label, q.multiple)}
                  title={opt.description}
                  className={`rounded px-2 py-1 text-xs ${
                    selected
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button
        onClick={() => onSubmit(selections)}
        disabled={!allAnswered || isPending}
        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium hover:bg-blue-500 disabled:opacity-50"
      >
        {isPending ? "Submitting..." : "Submit Answers"}
      </button>
    </div>
  );
}
