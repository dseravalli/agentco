import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, type SQL } from "drizzle-orm";
import * as schema from "./schema.js";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const DATA_DIR = path.join(os.homedir(), ".agentco");
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "agentco.db");

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL");
sqlite.exec("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
export { schema };

export type Project = typeof schema.projects.$inferSelect;
export type Task = typeof schema.tasks.$inferSelect;
export type Alert = typeof schema.alerts.$inferSelect;
export type TeamMember = typeof schema.teamMembers.$inferSelect;

export function findProject(where: SQL): Project | undefined {
  return db.select().from(schema.projects).where(where).get();
}

export function findTask(where: SQL): Task | undefined {
  return db.select().from(schema.tasks).where(where).get();
}

export function findAlert(where: SQL): Alert | undefined {
  return db.select().from(schema.alerts).where(where).get();
}

export function findTeamMembers(taskId: string): TeamMember[] {
  return db
    .select()
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.taskId, taskId))
    .all();
}
