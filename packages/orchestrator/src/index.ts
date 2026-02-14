import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { upgradeWebSocket, websocket } from "hono/bun";
import { projectRoutes } from "./routes/projects.js";
import { taskRoutes } from "./routes/tasks.js";
import { alertRoutes } from "./routes/alerts.js";
import { createWSRoutes } from "./routes/ws.js";
import { proxyRoutes } from "./routes/proxy.js";
import { ORCHESTRATOR_PORT } from "./types.js";
import { reconnectActiveTasks } from "./services/lifecycle.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: ["http://localhost:3000"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowHeaders: ["Content-Type"],
  })
);

app.get("/api/health", (c) => {
  return c.json({ healthy: true, timestamp: new Date().toISOString() });
});

app.route("/api/projects", projectRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/alerts", alertRoutes);

const wsRoutes = createWSRoutes(upgradeWebSocket);
app.route("/api", wsRoutes);

app.route("/", proxyRoutes);

console.log(`AgentCo orchestrator running on http://localhost:${ORCHESTRATOR_PORT}`);

reconnectActiveTasks().catch((err) => {
  console.error("[reconnect] failed:", err);
});

export default {
  port: ORCHESTRATOR_PORT,
  fetch: app.fetch,
  websocket,
};
