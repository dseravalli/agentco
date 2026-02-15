import { Hono } from "hono";
import { getGlobalConfig } from "../services/config.js";

export const configRoutes = new Hono();

configRoutes.get("/models", (c) => {
  const config = getGlobalConfig();
  return c.json(config.models);
});
