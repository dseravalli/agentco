import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, schema, findProject } from "../db/index.js";
import type { AgentCoConfig } from "../types.js";
import fs from "node:fs/promises";
import path from "node:path";
import slugify from "slugify";

export const projectRoutes = new Hono();

projectRoutes.get("/", (c) => {
  const projects = db.select().from(schema.projects).all();
  return c.json(projects);
});

projectRoutes.post("/", async (c) => {
  const body = await c.req.json<{ name: string; rootPath: string }>();

  if (!body.name || !body.rootPath) {
    return c.json({ error: "name and rootPath are required" }, 400);
  }

  const slug = slugify(body.name, { lower: true, strict: true });

  try {
    await fs.access(body.rootPath);
  } catch {
    return c.json({ error: `rootPath does not exist: ${body.rootPath}` }, 400);
  }

  const configPath = path.join(body.rootPath, ".agentco.json");
  let config: AgentCoConfig | null = null;
  try {
    const content = await fs.readFile(configPath, "utf-8");
    config = JSON.parse(content);
  } catch {
    // No .agentco.json found — project will use runtime defaults
  }

  const existing = findProject(eq(schema.projects.slug, slug));
  if (existing) {
    return c.json({ error: `Project with slug "${slug}" already exists` }, 409);
  }

  const project = db
    .insert(schema.projects)
    .values({ name: body.name, slug, rootPath: body.rootPath, config })
    .returning()
    .get();

  return c.json(project, 201);
});

projectRoutes.get("/:id", (c) => {
  const project = findProject(eq(schema.projects.id, c.req.param("id")));
  if (!project) return c.json({ error: "Project not found" }, 404);
  return c.json(project);
});

projectRoutes.delete("/:id", (c) => {
  const project = findProject(eq(schema.projects.id, c.req.param("id")));
  if (!project) return c.json({ error: "Project not found" }, 404);

  const tasks = db.select().from(schema.tasks).where(eq(schema.tasks.projectId, project.id)).all();
  for (const task of tasks) {
    db.delete(schema.teamMembers).where(eq(schema.teamMembers.taskId, task.id)).run();
    db.delete(schema.alerts).where(eq(schema.alerts.taskId, task.id)).run();
  }
  db.delete(schema.tasks).where(eq(schema.tasks.projectId, project.id)).run();
  db.delete(schema.projects).where(eq(schema.projects.id, project.id)).run();
  return c.json({ ok: true });
});

projectRoutes.post("/:id/sync", async (c) => {
  const project = findProject(eq(schema.projects.id, c.req.param("id")));
  if (!project) return c.json({ error: "Project not found" }, 404);

  let config: AgentCoConfig | null = null;
  try {
    const configPath = path.join(project.rootPath, ".agentco.json");
    const content = await fs.readFile(configPath, "utf-8");
    config = JSON.parse(content);
  } catch {
    return c.json({ error: "Could not read .agentco.json" }, 400);
  }

  const updated = db
    .update(schema.projects)
    .set({ config, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, project.id))
    .returning()
    .get();

  return c.json(updated);
});
