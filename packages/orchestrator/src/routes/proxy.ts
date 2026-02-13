import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { findTask } from "../db/index.js";
import { schema } from "../db/index.js";

export const proxyRoutes = new Hono();

proxyRoutes.all("/preview/:taskId/*", async (c) => {
  const taskId = c.req.param("taskId");
  const task = findTask(eq(schema.tasks.id, taskId));

  if (!task?.devPreviewPort) {
    return c.json({ error: "No dev preview running for this task" }, 404);
  }

  return proxyTo(c, task.devPreviewPort, `/preview/${taskId}`);
});

proxyRoutes.all("/agent/:taskId/*", async (c) => {
  const taskId = c.req.param("taskId");
  const task = findTask(eq(schema.tasks.id, taskId));

  if (!task?.opencodePort) {
    return c.json({ error: "No OpenCode instance running for this task" }, 404);
  }

  return proxyTo(c, task.opencodePort, `/agent/${taskId}`);
});

async function proxyTo(c: any, port: number, stripPrefix: string) {
  const url = new URL(c.req.url);
  const targetPath = url.pathname.slice(stripPrefix.length) || "/";
  const targetUrl = `http://127.0.0.1:${port}${targetPath}${url.search}`;

  try {
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");

    const response = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD"
        ? c.req.raw.body
        : undefined,
      redirect: "manual",
    });

    const respHeaders = new Headers(response.headers);
    // Rewrite Location headers for redirects
    const location = respHeaders.get("location");
    if (location?.startsWith("/")) {
      respHeaders.set("location", `${stripPrefix}${location}`);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
    });
  } catch {
    return c.json({ error: "Upstream server is not responding" }, 502);
  }
}
