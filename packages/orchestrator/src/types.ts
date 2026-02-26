export type {
  TaskStatus,
  AlertType,
  PortRanges,
  Project,
  Task,
  Alert,
  WSEvent,
} from "@agentco/shared";

export { PORT_RANGES, ORCHESTRATOR_PORT } from "@agentco/shared";

export type AlertPayload = Alert;

import type { Alert } from "@agentco/shared";

export interface AgentCoConfig {
  copyOnWorktree?: string[];
  envOverrides?: Record<string, string>;
  database?: {
    type: "postgres" | "none";
    connectionString: string;
    migrateCommand?: string;
    seedCommand?: string;
  };
  devPreview?: {
    command: string;
    portEnvVar?: string;
    healthCheck?: string;
    readyPattern?: string;
  };
  agent?: {
    defaultModel?: string;
    defaultAgent?: string;
    planMode?: boolean;
  };
}
