import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type {
  AgentCoConfig,
  TaskStatus,
  TaskMode,
  AlertType,
  TeamMemberRole,
  TeamMemberStatus,
} from "../types.js";

export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  rootPath: text("root_path").notNull(),
  config: text("config", { mode: "json" }).$type<AgentCoConfig>(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const tasks = sqliteTable("tasks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").$type<TaskStatus>().default("pending"),
  branchName: text("branch_name"),
  worktreePath: text("worktree_path"),
  opencodePort: integer("opencode_port"),
  opencodeSessionId: text("opencode_session_id"),
  devPreviewPort: integer("dev_preview_port"),
  databaseName: text("database_name"),
  mode: text("mode").$type<TaskMode>().default("solo"),
  model: text("model"),
  prUrl: text("pr_url"),
  error: text("error"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

export const teamMembers = sqliteTable("team_members", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  role: text("role").$type<TeamMemberRole>().notNull(),
  label: text("label").notNull(),
  opencodePort: integer("opencode_port"),
  opencodeSessionId: text("opencode_session_id"),
  status: text("status").$type<TeamMemberStatus>().default("pending"),
  assignedTasks: text("assigned_tasks", { mode: "json" }).$type<string[]>(),
  assignedFiles: text("assigned_files", { mode: "json" }).$type<string[]>(),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

export const alerts = sqliteTable("alerts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id),
  type: text("type").$type<AlertType>().notNull(),
  message: text("message").notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  read: integer("read", { mode: "boolean" }).default(false),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});
