# AgentCo - Agent Guidelines

## Project Management

- We use **Linear** for project management (MCP server is installed)
- The Linear project for this repo is **AgentCo**

## Project Overview

Bun monorepo for a multi-agent orchestration system. Four packages under `packages/`:

| Package        | Purpose                                        | Key Tech                  |
| -------------- | ---------------------------------------------- | ------------------------- |
| `shared`       | Type definitions, constants, shared interfaces | TypeScript                |
| `orchestrator` | HonoJS REST/WebSocket backend (port 8080)      | Hono, Drizzle ORM, SQLite |
| `cli`          | Commander.js CLI with tmux integration         | Commander                 |
| `tui`          | Terminal UI                                    | Solid.js, OpenTUI         |

## Build / Lint / Test Commands

```bash
bun install                                        # Install dependencies
bun run build                                      # Build all packages (tsc)
bun run dev                                        # Dev mode (orchestrator + tui in parallel)
bun run format                                     # Prettier across all packages
bun run lint                                       # ESLint across all packages
bun run typecheck                                  # tsc --noEmit across all packages

# Per-package commands (replace orchestrator with any package name)
bun run --filter @agentco/orchestrator build
bun run --filter @agentco/orchestrator lint
bun run --filter @agentco/orchestrator typecheck

# Orchestrator-specific
bun run --filter @agentco/orchestrator dev         # Dev with --watch
bun run --filter @agentco/orchestrator start       # Production start
bun run --filter @agentco/orchestrator db:push     # Push Drizzle schema to DB
bun run --filter @agentco/orchestrator db:migrate  # Run migrations
bun run --filter @agentco/orchestrator db:generate # Generate migrations
bun run --filter @agentco/orchestrator db:studio   # Open Drizzle Studio

bun run packages/cli/src/index.ts                  # Run CLI directly
```

### Testing

No test framework is configured yet. When tests are added, use `bun test` (Bun's
built-in test runner). Place test files alongside source as `*.test.ts`: `bun test path/to/file.test.ts`

## Code Style

### Formatting (Prettier)

- 2-space indentation
- Double quotes (not single)
- Semicolons required
- Trailing commas everywhere (`"all"`)
- 100 character line width

### Linting (ESLint)

Flat config (`eslint.config.mjs`) with `eslint.configs.recommended` + `typescript-eslint` recommended. Ignores: `**/dist/`, `**/node_modules/`, `.opencode/`.

### TypeScript

- `strict: true` is enabled
- Target: ES2022, module: ESNext, moduleResolution: bundler
- All packages use `"type": "module"` in package.json
- Use `.js` extensions in relative imports (even for `.ts` files): `import { foo } from "./bar.js"`
- Workspace imports use package names: `import { Task } from "@agentco/shared"`

### Imports

Order: (1) External packages (2) Workspace packages (`@agentco/*`) (3) Relative imports with `.js` extensions. Use named imports. Use `import type` for type-only imports:

```typescript
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { TaskMode } from "../types.js";
import * as lifecycle from "../services/lifecycle.js";
```

### Naming Conventions

| Element          | Convention          | Example                                 |
| ---------------- | ------------------- | --------------------------------------- |
| Files            | kebab-case          | `port-allocator.ts`, `event-monitor.ts` |
| Functions        | camelCase           | `allocatePort`, `findTask`              |
| Types/Interfaces | PascalCase          | `TaskStatus`, `AgentCoConfig`           |
| Constants        | UPPER_SNAKE_CASE    | `ORCHESTRATOR_PORT`, `PORT_RANGES`      |
| Components (TSX) | PascalCase          | `TaskList`, `StatusBadge`               |
| DB tables        | snake_case          | `team_members`, `opencode_port`         |
| Branches         | `agent/<task-slug>` | `agent/fix-login-bug-a1b2c3`            |

### Type Patterns

- `type` for unions/aliases, `interface` for entity shapes
- Derive DB types with Drizzle inference: `type Task = typeof schema.tasks.$inferSelect`
- Use `$type<T>()` on Drizzle columns for typed JSON/enum fields
- Use type predicates for filtering: `.filter((p): p is number => p !== null)`
- Explicit return types on exported functions

### Error Handling

- Fail fast with descriptive messages including context:
  ```typescript
  throw new Error(`No available ports in range ${range.min}-${range.max} for ${type}`);
  ```
- Fire-and-forget async with `.catch()` logging:
  ```typescript
  lifecycle.startTask(task.id).catch((err) => {
    logger.error("[tasks]", `Task ${task.id} lifecycle failed: ${err}`);
  });
  ```
- Best-effort cleanup with empty catch blocks (comment `// Best effort`):
  ```typescript
  try {
    await lifecycle.cleanupTask(task.id);
  } catch {
    /* Best effort */
  }
  ```
- Route handlers return structured errors: `c.json({ error: "message" }, 400)`
- Use `execa` with `{ reject: false }` and check `exitCode` manually

### Logging

Use the structured logger from `lib/log.ts` with bracketed prefixes:

```typescript
import * as logger from "../lib/log.js";
logger.info("[server]", `listening on port ${port}`);
logger.error("[tasks]", `Task ${id} failed: ${err}`);
```

### Comments

- Minimal comments; only comment genuinely confusing or non-obvious logic
- Use section markers for logical groupings: `// Enums / unions`, `// Constants`

### Database (Drizzle ORM + SQLite)

- Schema in `packages/orchestrator/src/db/schema.ts`
- All IDs are UUIDs generated with `crypto.randomUUID()`
- Timestamps stored as ISO text with SQLite `datetime('now')` defaults
- Use `.get()` for single results, `.all()` for lists, `.run()` for mutations
- Helper functions in `db/index.ts`: `findTask()`, `findProject()`, etc.
- WAL journal mode and foreign keys enabled

### Hono API Routes

- Each route file exports a `const fooRoutes = new Hono()` instance
- Mounted in `index.ts` with `app.route("/api/path", fooRoutes)`
- Parse request bodies with `c.req.json<T>()`
- Validate early, return `c.json({ error: "..." }, statusCode)`

### Solid.js TUI Patterns

- `createSignal` for local state, `createMemo` for derived values
- Control flow via `<Show>`, `<Switch>`/`<Match>`, `<For>`
- Providers for dependency injection (`useSDK()`, `useSync()`, `useRoute()`)

### Exports

- Named exports only (no default exports), except Hono server entry (`export default`)
- Use `export type` in re-export files (see `types.ts`)
- Namespace imports for service modules: `import * as lifecycle from "./services/lifecycle.js"`
