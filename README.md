# AgentCo

Self-hosted orchestration system for managing multiple [OpenCode](https://github.com/anomalyco/opencode) coding agents working on tasks across multiple projects simultaneously. Automates the complete task lifecycle from git branch management through PR submission.

## Overview

AgentCo is a monorepo with three packages:

- **orchestrator** - HonoJS backend that manages projects, tasks, git worktrees, OpenCode processes, dev servers, and database provisioning
- **tui** - Terminal UI built with Solid.js and OpenTUI for monitoring and managing tasks
- **cli** - Command-line interface for scripting and quick operations

```
 CLI / TUI
    │
    │ HTTP + WebSocket
    ▼
 Orchestrator (port 8080)
    │
    ├── Git worktree per task
    ├── OpenCode agent per task
    ├── Dev server per task
    └── SQLite database (~/.agentco/agentco.db)
```

### Task Lifecycle

```
pending → setting_up → agent_running → agent_done → pr_created → merged → archived
                              ↕
                         needs_input
```

## Prerequisites

- Bun
- OpenCode

## Getting Started

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Push database schema
cd packages/orchestrator && bun run db:push && cd ../..

# Start the orchestrator and TUI
bun run dev
```

## CLI Usage

```bash
# Projects
bun run packages/cli/src/index.ts project create <name> --path /path/to/repo
bun run packages/cli/src/index.ts project list

# Tasks
bun run packages/cli/src/index.ts task create <project> <title> [description]
bun run packages/cli/src/index.ts task list [--project name]
```

## Project Configuration

Each managed project can include an `.agentco.json` in its root:

```json
{
  "copyOnWorktree": [".env", "credentials/"],
  "envOverrides": { "PORT": "auto", "DATABASE_URL": "auto" },
  "database": {
    "type": "postgres",
    "connectionString": "postgresql://...",
    "migrateCommand": "npm run migrate"
  },
  "devPreview": {
    "command": "npm run dev",
    "portEnvVar": "PORT",
    "healthCheck": "/api/health"
  },
  "agent": {
    "defaultModel": "anthropic/claude-sonnet-4",
    "planMode": true
  }
}
```

## Development

```bash
# Run orchestrator + TUI in dev mode (with watch)
bun run dev

# Type checking
bun run typecheck

# Database management
cd packages/orchestrator
bun run db:push       # Apply schema changes
bun run db:generate   # Generate migrations
bun run db:studio     # Open Drizzle Studio
```