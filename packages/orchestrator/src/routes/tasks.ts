import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema, findTask, findProject } from "../db/index.js";
import slugify from "slugify";
import { nanoid } from "nanoid";
import * as lifecycle from "../services/lifecycle.js";
import { generateTitle } from "../services/title.js";

export const taskRoutes = new Hono();

taskRoutes.get("/", (c) => {
  const projectId = c.req.query("projectId");
  const status = c.req.query("status");

  let tasks = db.select().from(schema.tasks).all();

  if (projectId) {
    tasks = tasks.filter((t) => t.projectId === projectId);
  }
  if (status) {
    tasks = tasks.filter((t) => t.status === status);
  }

  return c.json(tasks);
});

taskRoutes.post("/", async (c) => {
  const body = await c.req.json<{
    projectId: string;
    description: string;
    model?: string;
  }>();

  if (!body.projectId || !body.description) {
    return c.json({ error: "projectId and description are required" }, 400);
  }

  const project = findProject(eq(schema.projects.id, body.projectId));
  if (!project) return c.json({ error: "Project not found" }, 404);

  const slug =
    slugify(body.description, { lower: true, strict: true }).slice(0, 40) +
    "-" +
    nanoid(6);

  const title = await generateTitle(body.description);

  const task = db
    .insert(schema.tasks)
    .values({
      projectId: body.projectId,
      slug,
      title,
      description: body.description,
      model: body.model || null,
    })
    .returning()
    .get();

  return c.json(task, 201);
});

taskRoutes.get("/:id", (c) => {
  const task = findTask(eq(schema.tasks.id, c.req.param("id")));
  if (!task) return c.json({ error: "Task not found" }, 404);
  return c.json(task);
});

taskRoutes.post("/:id/start", async (c) => {
  const task = findTask(eq(schema.tasks.id, c.req.param("id")));
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (task.status !== "pending" && task.status !== "failed" && task.status !== "aborted") {
    return c.json({ error: `Cannot start task in status: ${task.status}` }, 400);
  }

  lifecycle.startTask(task.id).catch((err) => {
    console.error(`Task ${task.id} lifecycle failed:`, err);
  });

  return c.json({ ok: true, message: "Task lifecycle started" });
});

taskRoutes.post("/:id/abort", async (c) => {
  try {
    await lifecycle.abortTask(c.req.param("id"));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

taskRoutes.post("/:id/retry", async (c) => {
  const task = findTask(eq(schema.tasks.id, c.req.param("id")));
  if (!task) return c.json({ error: "Task not found" }, 404);
  if (task.status !== "failed" && task.status !== "aborted") {
    return c.json({ error: "Can only retry failed or aborted tasks" }, 400);
  }

  try {
    await lifecycle.cleanupTask(task.id);
  } catch {
    // Best effort
  }

  db.update(schema.tasks)
    .set({
      status: "pending",
      error: null,
      worktreePath: null,
      branchName: null,
      opencodePort: null,
      opencodeSessionId: null,
      devPreviewPort: null,
      databaseName: null,
      prUrl: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.tasks.id, task.id))
    .run();

  lifecycle.startTask(task.id).catch((err) => {
    console.error(`Task ${task.id} retry failed:`, err);
  });

  return c.json({ ok: true, message: "Task retry started" });
});

taskRoutes.post("/:id/pr", async (c) => {
  try {
    const prUrl = await lifecycle.createPR(c.req.param("id"));
    return c.json({ ok: true, prUrl });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

taskRoutes.post("/:id/preview", async (c) => {
  try {
    const previewUrl = await lifecycle.startDevPreviewForTask(c.req.param("id"));
    return c.json({ ok: true, previewUrl });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

taskRoutes.post("/:id/cleanup", async (c) => {
  try {
    await lifecycle.cleanupTask(c.req.param("id"));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

taskRoutes.delete("/:id", async (c) => {
  const task = findTask(eq(schema.tasks.id, c.req.param("id")));
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (task.status !== "archived" && task.status !== "pending") {
    try {
      await lifecycle.cleanupTask(task.id);
    } catch {
      // Best effort
    }
  }

  db.delete(schema.alerts).where(eq(schema.alerts.taskId, task.id)).run();
  db.delete(schema.tasks).where(eq(schema.tasks.id, task.id)).run();

  return c.json({ ok: true });
});
