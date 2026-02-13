import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { alerts as alertsApi, type Alert } from "../api/client.js";
import { useWSConnected } from "../hooks/useWebSocket.js";

interface Props {
  onViewTask: (taskId: string) => void;
}

const ALERT_COLORS: Record<string, string> = {
  needs_permission: "border-l-orange-500",
  needs_input: "border-l-yellow-500",
  agent_complete: "border-l-green-500",
  preview_live: "border-l-cyan-500",
  pr_created: "border-l-purple-500",
  error: "border-l-red-500",
};

export function AlertPanel({ onViewTask }: Props) {
  const queryClient = useQueryClient();
  const wsConnected = useWSConnected();

  const { data: alertList = [] } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => alertsApi.list(),
    refetchInterval: wsConnected ? false : 5000,
  });

  const respondMutation = useMutation({
    mutationFn: ({ alertId, action }: { alertId: string; action: "approve" | "deny" }) =>
      alertsApi.respond(alertId, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const markReadMutation = useMutation({
    mutationFn: alertsApi.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const unread = alertList.filter((a) => !a.read);
  const read = alertList.filter((a) => a.read).slice(0, 10);

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-gray-400">
        Alerts
        {unread.length > 0 && (
          <span className="ml-2 rounded-full bg-red-600 px-1.5 py-0.5 text-xs">
            {unread.length}
          </span>
        )}
      </h3>

      {alertList.length === 0 ? (
        <p className="text-xs text-gray-600">No alerts.</p>
      ) : (
        <div className="space-y-2">
          {unread.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onViewTask={() => onViewTask(alert.taskId)}
              onRespond={(action) =>
                respondMutation.mutate({ alertId: alert.id, action })
              }
              onDismiss={() => markReadMutation.mutate(alert.id)}
            />
          ))}
          {read.length > 0 && unread.length > 0 && (
            <hr className="border-gray-800" />
          )}
          {read.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onViewTask={() => onViewTask(alert.taskId)}
              dismissed
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AlertCard({
  alert,
  onViewTask,
  onRespond,
  onDismiss,
  dismissed,
}: {
  alert: Alert;
  onViewTask: () => void;
  onRespond?: (action: "approve" | "deny") => void;
  onDismiss?: () => void;
  dismissed?: boolean;
}) {
  const needsAction =
    !dismissed &&
    (alert.type === "needs_permission" || alert.type === "needs_input");

  return (
    <div
      className={`rounded border-l-2 bg-gray-900 p-2.5 text-xs ${
        ALERT_COLORS[alert.type] ?? "border-l-gray-600"
      } ${dismissed ? "opacity-50" : ""}`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium uppercase text-gray-500">{alert.type.replace("_", " ")}</span>
        <div className="flex gap-1">
          {!dismissed && (
            <button
              onClick={onViewTask}
              className="text-blue-400 hover:text-blue-300"
            >
              View
            </button>
          )}
          {!dismissed && !needsAction && onDismiss && (
            <button
              onClick={onDismiss}
              className="text-gray-500 hover:text-gray-300"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
      <p className={dismissed ? "text-gray-600" : "text-gray-300"}>
        {alert.message}
      </p>
      {needsAction && onRespond && (
        <div className="mt-2 flex gap-1">
          <button
            onClick={() => onRespond("approve")}
            className="rounded bg-green-700 px-2 py-0.5 text-xs hover:bg-green-600"
          >
            Approve
          </button>
          <button
            onClick={() => onRespond("deny")}
            className="rounded bg-red-800 px-2 py-0.5 text-xs hover:bg-red-700"
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
}
