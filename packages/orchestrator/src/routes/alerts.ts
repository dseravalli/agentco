import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { db, schema, findAlert, findTask } from "../db/index.js";
import * as opencode from "../services/opencode.js";
import * as logger from "../lib/log.js";

export const alertRoutes = new Hono();

alertRoutes.get("/", (c) => {
  const taskId = c.req.query("taskId");
  const unreadOnly = c.req.query("unread") === "true";

  let alerts = db.select().from(schema.alerts).orderBy(desc(schema.alerts.createdAt)).all();

  if (taskId) {
    alerts = alerts.filter((a) => a.taskId === taskId);
  }
  if (unreadOnly) {
    alerts = alerts.filter((a) => !a.read);
  }

  return c.json(alerts);
});

alertRoutes.post("/:id/read", (c) => {
  const alert = findAlert(eq(schema.alerts.id, c.req.param("id")));
  if (!alert) return c.json({ error: "Alert not found" }, 404);

  db.update(schema.alerts).set({ read: true }).where(eq(schema.alerts.id, alert.id)).run();

  return c.json({ ok: true });
});

alertRoutes.post("/:id/respond", async (c) => {
  const body = await c.req.json<{
    action: "approve" | "deny";
    answers?: string[][];
  }>();

  const alert = findAlert(eq(schema.alerts.id, c.req.param("id")));
  if (!alert) return c.json({ error: "Alert not found" }, 404);

  const task = findTask(eq(schema.tasks.id, alert.taskId));
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  const metadata = alert.metadata as Record<string, unknown> | null;
  const teamMemberId = metadata?.teamMemberId as string | undefined;

  // Resolve the correct port and session — team members store these on the
  // team_members row, not on the task itself.
  let port: number | null = task.opencodePort;
  let sessionId: string | null = task.opencodeSessionId;

  if (teamMemberId) {
    const member = db
      .select()
      .from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.taskId, task.id), eq(schema.teamMembers.id, teamMemberId)))
      .get();

    if (member) {
      port = member.opencodePort;
      sessionId = member.opencodeSessionId;
      logger.debug("[alerts]", `resolved team member "${member.label}" port=${port}`);
    }
  }

  if (!port) {
    return c.json({ error: "Task has no active OpenCode instance" }, 400);
  }

  if (alert.type === "needs_question") {
    const questionID = metadata?.questionID as string | undefined;
    if (!questionID) {
      return c.json({ error: "No questionID found on alert" }, 400);
    }
    if (!body.answers) {
      return c.json({ error: "answers[] required for question alerts" }, 400);
    }

    try {
      await opencode.answerQuestion(port, questionID, body.answers);
    } catch (err) {
      return c.json({ error: `Failed to answer question: ${String(err)}` }, 500);
    }
  } else if (alert.type === "needs_permission" || alert.type === "needs_input") {
    const permissionId = metadata?.permissionID as string | undefined;

    if (!permissionId || !sessionId) {
      return c.json({ error: "No permissionID or sessionID found" }, 400);
    }

    try {
      const response = body.action === "approve" ? ("once" as const) : ("reject" as const);
      await opencode.respondToPermission(port, sessionId, permissionId, response);
    } catch (err) {
      return c.json({ error: `Failed to respond: ${String(err)}` }, 500);
    }
  } else {
    return c.json({ error: "Alert does not require a response" }, 400);
  }

  db.update(schema.alerts).set({ read: true }).where(eq(schema.alerts.id, alert.id)).run();

  return c.json({ ok: true });
});
