import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, type SQL } from "drizzle-orm";
import * as schema from "./schema.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../agentco.db");

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };

export type Project = typeof schema.projects.$inferSelect;
export type Task = typeof schema.tasks.$inferSelect;
export type Alert = typeof schema.alerts.$inferSelect;

export function findProject(where: SQL): Project | undefined {
  return db.select().from(schema.projects).where(where).get();
}

export function findTask(where: SQL): Task | undefined {
  return db.select().from(schema.tasks).where(where).get();
}

export function findAlert(where: SQL): Alert | undefined {
  return db.select().from(schema.alerts).where(where).get();
}
