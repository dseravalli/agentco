# AgentCo

> [!WARNING]
> AgentCo is alpha software under heavy development.

> [!WARNING]
> Requires [patched version of OpenCode](https://github.com/dseravalli/opencode/tree/sighup-handler) while issues [#10564](https://github.com/anomalyco/opencode/issues/10564) and [#11225](https://github.com/anomalyco/opencode/issues/11225) are open

Self-hosted orchestration system for managing multiple [OpenCode](https://github.com/anomalyco/opencode) coding agents working on tasks across multiple projects simultaneously. Automates the complete task lifecycle from git branch management through PR submission.

## Features

- TUI and CLI for managing a fleet of OpenCode agents, organized by project
- Automatic git worktree and branch management
- Plan mode with approval workflow before build execution
- Attach to any running agent in a new tmux pane
- Real-time OS notifications
- Automatic PR submission via GitHub CLI
- Dev server management and database provisioning per task

### Coming Soon

- Automatic test environments per PR
- Automatic task decomposition
- Web UI
- Linear integration
- OpenClaw integration

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
                            ↕               ↕
                       needs_input      plan_ready
                                             ↓
                                        preview_live

Any state can transition to → failed or aborted
```

## Prerequisites

- [Bun](https://bun.sh)
- [OpenCode](https://github.com/anomalyco/opencode)
- [tmux](https://github.com/tmux/tmux) (for `task attach`)
- git
- [GitHub CLI (`gh`)](https://cli.github.com/) (for PR creation)

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
agentco project create <name> --path /path/to/repo
agentco project list

# Tasks
agentco task create <project> [description] --file <path>
agentco task list [--project <name>]
agentco task attach <taskId>    # Open OpenCode TUI in tmux pane
agentco task kill <taskId>      # Abort, clean up, and delete

# TUI
agentco tui
```

> Tip: `bun run cli` at the repo root is a shortcut for `agentco`.

## Project Configuration

Each managed project can include an `.agentco.json` in its root:

```json
{
  "copyOnWorktree": [".env", "credentials/"],
  "envOverrides": { "PORT": "auto", "DATABASE_URL": "auto" },
  "database": {
    "type": "postgres",
    "connectionString": "postgresql://...",
    "migrateCommand": "npm run migrate",
    "seedCommand": "npm run seed"
  },
  "devPreview": {
    "command": "npm run dev",
    "portEnvVar": "PORT",
    "healthCheck": "/api/health",
    "readyPattern": "listening"
  },
  "agent": {
    "defaultModel": "anthropic/claude-opus-4-6"
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
bun run db:migrate    # Run migrations
bun run db:studio     # Open Drizzle Studio
```
