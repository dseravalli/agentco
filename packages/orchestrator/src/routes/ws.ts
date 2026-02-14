import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { subscribe } from "../services/event-monitor.js";
import type { WSEvent } from "../types.js";

type UpgradeWebSocket = (handler: (c: any) => {
  onOpen?: (evt: Event, ws: WSContext) => void;
  onMessage?: (evt: MessageEvent, ws: WSContext) => void;
  onClose?: (evt: CloseEvent, ws: WSContext) => void;
  onError?: (evt: Event, ws: WSContext) => void;
}) => any;

export function createWSRoutes(upgradeWebSocket: UpgradeWebSocket) {
  const wsRoutes = new Hono();

  wsRoutes.get(
    "/ws",
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | null = null;

      return {
        onOpen(_evt, ws) {
          console.log("WebSocket client connected");

          unsubscribe = subscribe((event: WSEvent) => {
            try {
              ws.send(JSON.stringify(event));
            } catch {
              // Client may have disconnected
            }
          });
        },

        onMessage(evt, ws) {
          try {
            const data = JSON.parse(evt.data as string);
            if (data.type === "ping") {
              ws.send(JSON.stringify({ type: "pong" }));
            }
          } catch {
            // Ignore malformed messages
          }
        },

        onClose() {
          console.log("WebSocket client disconnected");
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        },

        onError(evt) {
          console.error("WebSocket error:", evt);
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        },
      };
    })
  );

  return wsRoutes;
}
