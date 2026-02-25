import { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import { subscribe } from "../services/event-monitor.js";
import type { WSEvent } from "../types.js";
import * as logger from "../lib/log.js";

export function createWSRoutes(upgradeWebSocket: UpgradeWebSocket) {
  const wsRoutes = new Hono();

  wsRoutes.get(
    "/ws",
    upgradeWebSocket(() => {
      let unsubscribe: (() => void) | null = null;

      return {
        onOpen(_evt, ws) {
          logger.debug("[ws]", "client connected");

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
          logger.debug("[ws]", "client disconnected");
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        },

        onError(evt) {
          logger.error("[ws]", `error: ${evt}`);
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
        },
      };
    }),
  );

  return wsRoutes;
}
