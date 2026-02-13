import { useEffect, useRef, useCallback, useState, createContext, useContext } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface WSEvent {
  type: string;
  taskId?: string;
  status?: string;
  alert?: Record<string, unknown>;
  message?: string;
  event?: unknown;
}

const WSContext = createContext<boolean>(false);

export const WSProvider = WSContext.Provider;

export function useWSConnected() {
  return useContext(WSContext);
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);

    ws.onopen = () => {
      setConnected(true);
      queryClient.invalidateQueries();
      if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }
    };

    ws.onmessage = (event) => {
      try {
        const data: WSEvent = JSON.parse(event.data);

        if (data.type === "task:status_changed") {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          if (data.taskId) {
            queryClient.invalidateQueries({ queryKey: ["task", data.taskId] });
          }
        }

        if (data.type === "task:alert") {
          queryClient.invalidateQueries({ queryKey: ["alerts"] });
          console.log("[ws] task:alert received:", data.alert?.type, data.alert?.message);
          notifyIfActionable(data.alert);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [queryClient]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected };
}

const ACTIONABLE_TYPES = new Set([
  "needs_question",
  "needs_permission",
  "needs_input",
]);

function notifyIfActionable(alert?: Record<string, unknown>) {
  if (!alert) return;
  if (!ACTIONABLE_TYPES.has(alert.type as string)) return;

  if (!("Notification" in window)) return;

  if (Notification.permission === "default") {
    Notification.requestPermission();
    return;
  }

  if (Notification.permission !== "granted") return;

  new Notification("AgentCo — Agent needs input", {
    body: (alert.message as string) ?? "An agent is waiting for your response",
    tag: alert.id as string,
  });
}
