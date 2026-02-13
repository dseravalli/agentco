# AgentCo — Multi-Agent Orchestration System

## Overview

AgentCo is a self-hosted orchestration system for managing multiple OpenCode coding agents working on tasks across multiple projects simultaneously. It automates the full lifecycle: git branch management, worktree creation, environment setup, database provisioning, agent supervision, dev preview access, and PR submission.

Runs on macOS (local development) or a Linux cloud server. Accessed via a web dashboard.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Web Dashboard (React)                 │
│  ┌───────────┐ ┌───────────┐ ┌────────────────────────┐ │
│  │ Projects   │ │ Tasks     │ │ Agent Sessions         │ │
│  │ Registry   │ │ Pipeline  │ │ (embedded OpenCode UI) │ │
│  └───────────┘ └───────────┘ └────────────────────────┘ │
└─────────────────┬───────────────────────────────────────┘
                  │ WebSocket + REST
┌─────────────────▼───────────────────────────────────────┐
│               Orchestrator (Node/TypeScript)             │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Project      │  │ Task         │  │ Port          │ │
│  │ Registry     │  │ Lifecycle    │  │ Allocator     │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │ Database     │  │ SSE Event    │  │ Reverse       │ │
│  │ Provisioner  │  │ Monitor      │  │ Proxy         │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
└──┬──────────┬──────────┬──────────┬─────────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
OpenCode   OpenCode   Dev Server  Dev Server
:4101      :4102      :3001       :3002
(task-1)   (task-2)   (task-1)    (task-2)
```

---

## Core Components

### 1. Orchestrator (Backend)

**Stack:** HonoJS, Drizzle ORM, PostgreSQL, TypeScript

The central process that manages everything. Exposes a REST + WebSocket API consumed by the dashboard.

**Responsibilities:**

- Project registration and configuration
- Task creation and lifecycle management
- Git operations (pull, worktree create/remove, branch management)
- Environment file copying and variable overrides
- Database provisioning per worktree
- OpenCode server process spawning and management
- SSE event stream consumption from each OpenCode instance
- Port allocation for OpenCode instances and dev preview servers
- Reverse proxy for dev preview and agent UI access
- PR creation via `gh` CLI when agent completes
- Alert/notification dispatch to dashboard

### 2. Dashboard (Frontend)

**Stack:** React, TailwindCSS, WebSocket client

**Views:**

- **Projects list** — registered projects with status summary
- **Task board** — all active/completed tasks across projects with status indicators
- **Task detail** — live agent output, permission requests, diff preview, logs
- **Agent session** — embedded OpenCode web UI (iframe or new tab link)
- **Dev preview** — link/iframe to the running dev server for the worktree

**Alert types surfaced:**

- Agent needs permission approval (tool use authorization)
- Agent is waiting for user input
- Agent considers task complete
- PR created — link to GitHub PR
- Dev preview is live — link to preview URL
- Agent errored or stalled

### 3. OpenCode Instances

Each task gets a dedicated `opencode serve` process running inside the task's worktree directory. The orchestrator interacts with it via the `@opencode-ai/sdk`.

**Key SDK interactions:**

- `createOpencodeClient({ baseUrl })` — connect to instance
- `session.create()` — initialize a session
- `session.prompt()` — send the task description
- `event.subscribe()` — SSE stream for real-time status
- `session.abort()` — cancel a runaway agent
- `session.shell()` — run commands (e.g., `gh pr create`)
- `postSessionByIdPermissionsByPermissionId()` — respond to tool permission requests
- `GET /session/status` — poll session states

### 4. Reverse Proxy

A lightweight HTTP proxy (built into the orchestrator via HonoJS) that routes requests to the correct worktree dev server or OpenCode web UI based on task ID.

**Route mapping:**

```
/preview/:taskId/*  →  localhost:<dev-server-port>
/agent/:taskId/*    →  localhost:<opencode-port>
```

Ports are dynamically assigned by the orchestrator and tracked in the database.

---

## Task Lifecycle

### Full sequence from task creation to PR:

```
1.  User creates task in dashboard
    ├── Selects project
    ├── Enters task description
    └── Optionally selects model/agent config

2.  Orchestrator: Git setup
    ├── cd <project-root>
    ├── git fetch origin
    ├── git pull origin main
    ├── git worktree add ../<project>-<taskSlug> -b agent/<taskSlug>
    └── cd ../<project>-<taskSlug>

3.  Orchestrator: Environment setup
    ├── Copy files listed in .agentco.json copyOnWorktree
    ├── Apply envOverrides (auto-assign PORT, DATABASE_URL, etc.)
    └── Write modified .env to worktree

4.  Orchestrator: Database provisioning (if configured)
    ├── CREATE DATABASE <project>_<taskSlug>;
    │   (or CREATE DATABASE ... TEMPLATE <project>_template;)
    ├── Update DATABASE_URL in worktree .env
    ├── Run migrateCommand in worktree directory
    └── Optionally run seedCommand

5.  Orchestrator: Start OpenCode
    ├── Allocate port for OpenCode server
    ├── Spawn: opencode serve --port <port> --cors <dashboard-origin>
    ├── Wait for health check: GET /global/health
    └── Store instance metadata (port, PID, task association)

6.  Orchestrator: Start agent session
    ├── client = createOpencodeClient({ baseUrl })
    ├── session = await client.session.create({ body: { title: taskSlug } })
    ├── Subscribe to client.event.subscribe() for real-time monitoring
    └── await client.session.prompt({ path: { id: session.id }, body: {
    │     parts: [{ type: "text", text: taskDescription }],
    │     model: { providerID, modelID }
    │   }})
    └── (prompt is sent async — orchestrator monitors via SSE)

7.  Orchestrator: Monitor agent via SSE events
    ├── On permission_request → alert dashboard, await user response,
    │   call postSessionByIdPermissionsByPermissionId()
    ├── On session stall/idle → alert dashboard
    └── On completion signal → proceed to step 8

8.  Orchestrator: Dev preview (if configured)
    ├── Allocate port for dev server
    ├── Spawn devPreview.command in worktree
    ├── Poll healthCheck endpoint or match readyPattern in stdout
    ├── Register route in reverse proxy
    └── Alert dashboard with preview URL

9.  Orchestrator: PR submission
    ├── Run in worktree: git add -A && git commit -m "<task description>"
    ├── git push origin agent/<taskSlug>
    ├── gh pr create --title "<task>" --body "<agent session summary>"
    └── Alert dashboard with PR URL

10. Orchestrator: Cleanup (on user trigger or auto after merge)
    ├── Stop dev server process
    ├── Stop OpenCode server process
    ├── DROP DATABASE <project>_<taskSlug>;
    ├── git worktree remove ../<project>-<taskSlug>
    └── git branch -d agent/<taskSlug> (if merged)
```

---

## Project Configuration

Each project contains an `.agentco.json` at its root:

```json
{
  "copyOnWorktree": [".env", ".env.local", "credentials/service-account.json"],
  "envOverrides": {
    "PORT": "auto",
    "DATABASE_URL": "auto"
  },
  "database": {
    "type": "postgres",
    "connectionString": "postgresql://localhost:5432",
    "templateDatabase": "myapp_template",
    "migrateCommand": "npx drizzle-kit push",
    "seedCommand": "npm run db:seed"
  },
  "devPreview": {
    "command": "npm run dev",
    "portEnvVar": "PORT",
    "healthCheck": "/api/health",
    "readyPattern": "ready on port"
  },
  "agent": {
    "defaultModel": "anthropic/claude-sonnet-4-20250514",
    "defaultAgent": "coder",
    "planMode": true
  }
}
```

### Configuration Reference

| Key                         | Type                     | Description                                                                                                                                                       |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `copyOnWorktree`            | `string[]`               | Gitignored files/dirs to copy from main worktree into new worktrees                                                                                               |
| `envOverrides`              | `Record<string, string>` | Env vars to override. `"auto"` = orchestrator assigns. `"inherit"` = copy from parent. Literal string = use that value.                                           |
| `database.type`             | `"postgres" \| "none"`   | Database provisioning strategy                                                                                                                                    |
| `database.connectionString` | `string`                 | Base Postgres connection (without database name)                                                                                                                  |
| `database.templateDatabase` | `string?`                | Optional. If set, new databases are cloned from this template via `CREATE DATABASE ... TEMPLATE` for instant provisioning with migrations + seed data pre-applied |
| `database.migrateCommand`   | `string`                 | Command to run migrations in the worktree                                                                                                                         |
| `database.seedCommand`      | `string?`                | Optional command to seed the database                                                                                                                             |
| `devPreview.command`        | `string`                 | Shell command to start the dev server                                                                                                                             |
| `devPreview.portEnvVar`     | `string`                 | Env var name the dev server reads its port from                                                                                                                   |
| `devPreview.healthCheck`    | `string?`                | HTTP path to poll for readiness                                                                                                                                   |
| `devPreview.readyPattern`   | `string?`                | Stdout pattern indicating the server is ready                                                                                                                     |
| `agent.defaultModel`        | `string`                 | Default LLM model for agent sessions                                                                                                                              |
| `agent.defaultAgent`        | `string?`                | Default OpenCode agent to use                                                                                                                                     |
| `agent.planMode`            | `boolean?`               | Whether to start in plan mode (agent proposes before executing)                                                                                                   |

**Projects without a database** (e.g., iOS, static sites) simply omit the `database` key. Projects without a dev preview omit `devPreview`. The orchestrator adapts accordingly.

---

## Database Provisioning

### Standard Flow

```sql
CREATE DATABASE myapp_task_123;
```

Then run `migrateCommand` + `seedCommand` in the worktree.

### Template Database Flow (Recommended for Speed)

Maintain a pre-migrated, pre-seeded template database:

```sql
CREATE DATABASE myapp_task_123 TEMPLATE myapp_template;
```

This is a near-instant filesystem-level copy. No migrations or seeding needed. The orchestrator can refresh the template on main branch changes:

```
git pull origin main → run migrate on template db → done
```

### Cleanup

```sql
DROP DATABASE myapp_task_123;
```

Executed when the task is archived/merged or manually by the user.

### Connection String Construction

Given `connectionString: "postgresql://user:pass@localhost:5432"` and task slug `task-123` for project `myapp`:

```
postgresql://user:pass@localhost:5432/myapp_task_123
```

Written into the worktree's `.env` as `DATABASE_URL`.

---

## Port Allocation

The orchestrator maintains a port allocator that tracks assigned ports and avoids collisions.

**Port ranges:**
| Service | Range | Example |
|---------|-------|---------|
| Orchestrator API | 8080 | `http://localhost:8080` |
| Dashboard | 3000 | `http://localhost:3000` |
| OpenCode instances | 4100–4199 | `http://localhost:4101` |
| Dev preview servers | 5100–5199 | `http://localhost:5101` |

Ports are allocated sequentially within each range and recycled when tasks are cleaned up. Port assignments are persisted in the orchestrator database to survive restarts.

---

## Network Access

### Local Development (macOS)

Everything runs on localhost. Dashboard at `http://localhost:3000`. Dev previews and agent UIs accessed directly or via the reverse proxy at `http://localhost:8080/preview/:taskId`.

### Remote Server via Tailscale

The server has a Tailscale IP (e.g., `100.x.y.z`). The orchestrator's reverse proxy handles all routing:

```
http://100.x.y.z:8080                  →  Dashboard
http://100.x.y.z:8080/preview/:taskId  →  Dev server for that task
http://100.x.y.z:8080/agent/:taskId    →  OpenCode web UI for that task
```

No additional Tailscale configuration required beyond having the server on the tailnet. The orchestrator already knows all ports — the proxy config is derived state.

**Optional upgrade:** Use `tailscale serve` for HTTPS URLs:

```bash
tailscale serve --bg --set-path / http://localhost:8080
```

Gives you `https://<machine>.tail1234.ts.net/` with automatic TLS.

---

## Orchestrator Data Model

Stored in PostgreSQL via Drizzle.

### Projects

```typescript
projects = pgTable("projects", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  rootPath: text().notNull(), // absolute path to project root
  config: jsonb().$type<AgentCoConfig>(), // parsed .agentco.json
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow(),
});
```

### Tasks

```typescript
tasks = pgTable("tasks", {
  id: uuid().primaryKey().defaultRandom(),
  projectId: uuid().references(() => projects.id),
  slug: text().notNull(),
  title: text().notNull(),
  description: text().notNull(), // full task prompt sent to agent
  status: text().$type<TaskStatus>().default("pending"),
  branchName: text(),
  worktreePath: text(),
  opencodePort: integer(),
  opencodeSessionId: text(),
  devPreviewPort: integer(),
  databaseName: text(),
  prUrl: text(),
  error: text(),
  createdAt: timestamp().defaultNow(),
  updatedAt: timestamp().defaultNow(),
});

type TaskStatus =
  | "pending" // created, not started
  | "setting_up" // git/env/db provisioning
  | "agent_running" // opencode session active
  | "needs_input" // agent waiting for permission or user input
  | "agent_done" // agent signaled completion
  | "preview_live" // dev server running
  | "pr_created" // PR submitted
  | "merged" // PR merged, ready for cleanup
  | "archived" // cleaned up
  | "failed"; // error state
```

### Alerts

```typescript
alerts = pgTable("alerts", {
  id: uuid().primaryKey().defaultRandom(),
  taskId: uuid().references(() => tasks.id),
  type: text().$type<AlertType>().notNull(),
  message: text().notNull(),
  metadata: jsonb(), // permission ID, PR URL, etc.
  read: boolean().default(false),
  createdAt: timestamp().defaultNow(),
});

type AlertType =
  | "needs_permission"
  | "needs_input"
  | "agent_complete"
  | "preview_live"
  | "pr_created"
  | "error";
```

---

## API Design (Orchestrator)

### Projects

```
GET    /api/projects              List all projects
POST   /api/projects              Register a project { name, rootPath }
GET    /api/projects/:id          Get project details + parsed config
DELETE /api/projects/:id          Unregister a project
POST   /api/projects/:id/sync     Re-read .agentco.json from disk
```

### Tasks

```
GET    /api/tasks                 List all tasks (filterable by project, status)
POST   /api/tasks                 Create a task { projectId, title, description }
GET    /api/tasks/:id             Get task details (includes ports, URLs, status)
POST   /api/tasks/:id/start       Begin task lifecycle
POST   /api/tasks/:id/abort       Abort the agent session
POST   /api/tasks/:id/retry       Retry a failed task
POST   /api/tasks/:id/pr          Trigger PR creation
POST   /api/tasks/:id/cleanup     Teardown worktree, db, processes
DELETE /api/tasks/:id             Delete task record
```

### Alerts

```
GET    /api/alerts                List alerts (filterable, unread first)
POST   /api/alerts/:id/read       Mark alert as read
POST   /api/alerts/:id/respond    Respond to a permission/input alert { response }
```

### Agent Proxy

```
GET    /agent/:taskId/*           Proxy to OpenCode web UI
GET    /preview/:taskId/*         Proxy to dev preview server
```

### WebSocket

```
WS     /api/ws                    Real-time events
```

**WebSocket event types:**

```typescript
type WSEvent =
  | { type: "task:status_changed"; taskId: string; status: TaskStatus }
  | { type: "task:alert"; taskId: string; alert: Alert }
  | { type: "task:log"; taskId: string; message: string }
  | { type: "agent:event"; taskId: string; event: OpenCodeSSEEvent };
```

---

## Implementation Plan

### Phase 1 — Core Orchestrator

- [ ] Project scaffold: HonoJS + Drizzle + PostgreSQL
- [ ] Data model: projects, tasks, alerts tables
- [ ] Project registration: read `.agentco.json`, store config
- [ ] Port allocator service
- [ ] Git operations module: fetch, pull, worktree add/remove, branch management
- [ ] Environment setup module: file copy, env var override, `.env` rewriting
- [ ] Database provisioner: create/drop databases, run migrations, template support

### Phase 2 — OpenCode Integration

- [ ] OpenCode process manager: spawn `opencode serve`, health check, graceful shutdown
- [ ] SDK client wrapper: session create, prompt, abort, permissions
- [ ] SSE event consumer: subscribe to each instance, parse events, update task status
- [ ] Permission forwarding: surface to API, accept responses, relay to OpenCode
- [ ] Completion detection: identify when agent is done, trigger next steps

### Phase 3 — Dashboard

- [ ] React app scaffold with Tailwind
- [ ] Project list view
- [ ] Task board: cards grouped by status with real-time updates
- [ ] Task detail view: status timeline, agent logs, alerts
- [ ] Alert panel: unread alerts with action buttons (approve/deny permissions)
- [ ] Embedded agent UI: iframe to OpenCode web interface
- [ ] Dev preview links
- [ ] WebSocket integration for live updates

### Phase 4 — Dev Preview & PR

- [ ] Dev server process manager: spawn, health poll, stdout pattern matching
- [ ] Reverse proxy: route /preview/:taskId to correct port
- [ ] PR creation flow: git add/commit/push + `gh pr create`
- [ ] PR link surfacing in dashboard

### Phase 5 — Polish & Remote Deployment

- [ ] Tailscale-aware URL generation in dashboard
- [ ] Process supervision: restart crashed OpenCode/dev server instances
- [ ] Task retry/resume logic
- [ ] Bulk operations: clean up all completed tasks
- [ ] Template database refresh automation (on main branch update)
- [ ] Logging and error reporting

---

## Directory Structure

```
agentco/
├── packages/
│   ├── orchestrator/
│   │   ├── src/
│   │   │   ├── index.ts              # HonoJS app entry
│   │   │   ├── routes/
│   │   │   │   ├── projects.ts
│   │   │   │   ├── tasks.ts
│   │   │   │   ├── alerts.ts
│   │   │   │   └── ws.ts
│   │   │   ├── services/
│   │   │   │   ├── git.ts             # Git operations
│   │   │   │   ├── worktree.ts        # Worktree + env setup
│   │   │   │   ├── database.ts        # DB provisioning
│   │   │   │   ├── opencode.ts        # OpenCode process + SDK wrapper
│   │   │   │   ├── port-allocator.ts
│   │   │   │   ├── dev-preview.ts     # Dev server management
│   │   │   │   ├── proxy.ts           # Reverse proxy
│   │   │   │   └── lifecycle.ts       # Task lifecycle orchestration
│   │   │   ├── db/
│   │   │   │   ├── schema.ts          # Drizzle schema
│   │   │   │   └── index.ts           # DB client
│   │   │   └── types.ts
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── dashboard/
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ProjectList.tsx
│       │   │   ├── TaskBoard.tsx
│       │   │   ├── TaskDetail.tsx
│       │   │   ├── AlertPanel.tsx
│       │   │   └── AgentEmbed.tsx
│       │   ├── hooks/
│       │   │   └── useWebSocket.ts
│       │   └── api/
│       │       └── client.ts
│       ├── package.json
│       └── tsconfig.json
├── package.json                       # Workspace root
└── README.md
```

---

## Dependencies

### Orchestrator

- `hono` — HTTP framework
- `drizzle-orm` + `drizzle-kit` + `pg` — Database
- `@opencode-ai/sdk` — OpenCode client
- `execa` — Process spawning (git, opencode serve, dev servers)
- `http-proxy` or built-in HonoJS proxy — Reverse proxy
- `ws` — WebSocket server

### Dashboard

- `react` + `react-dom`
- `tailwindcss`
- `@tanstack/react-query` — Data fetching
- Standard WebSocket API

### System Requirements

- Node.js 20+
- PostgreSQL 15+
- Git 2.38+ (worktree support)
- `gh` CLI (GitHub PR creation)
- `opencode` CLI installed globally
- Tailscale (for remote access)
