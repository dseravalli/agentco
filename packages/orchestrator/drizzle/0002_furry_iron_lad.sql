CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`role` text NOT NULL,
	`label` text NOT NULL,
	`opencode_port` integer,
	`opencode_session_id` text,
	`status` text DEFAULT 'pending',
	`assigned_tasks` text,
	`assigned_files` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `mode` text DEFAULT 'solo';