# Multi-Agent Team Mode — Implementation Plan

## Overview

Optional "team" mode for tasks. A team task has a leader agent that produces a plan, then N member agents are spawned to work in parallel in a shared worktree. The orchestrator mediates all communication.

### Key Decisions

| Decision | Choice |
|---|---|
| Plan handoff | Leader writes `.agentco/team-plan.json`, orchestrator reads on `session.idle` |
| Plan format | JSON with strict schema |
| Worktrees | Shared — one worktree per task, all agents work in same directory |
| File ownership | Prompt-only (no enforcement layer) |
| Data model | `mode` column on tasks + `team_members` table; solo mode unchanged |
| Communication | Phase 2: orchestrator-mediated, idle-aware batched delivery |
| Team size | 2-4 members typical |
| Tmux layout | Leader full-height left, members horizontal-split right (`main-vertical`) |

---

## Stage 1: Schema & Types — Complete

**Status**: Complete

**Changes**:

- `packages/orchestrator/src/db/schema.ts` — added `mode` column to `tasks`, created `team_members` table
- `packages/orchestrator/src/types.ts` — added `TaskMode`, `TeamMemberRole`, `TeamMemberStatus`, `TeamPlan`, `team:member_status` WSEvent
- `packages/orchestrator/src/db/index.ts` — exported `TeamMember` type, added `findTeamMembers()` helper
- `packages/tui/src/lib/types.ts` — mirrored types: `TaskMode`, `TeamMemberRole`, `TeamMemberStatus`, `TeamMember`, updated `Task` interface with `mode`
- `packages/cli/src/client.ts` — added `TaskMode`, `TeamMember` types, `mode` to `Task`, `createTask()` accepts mode, added `listTeamMembers()`
- `packages/orchestrator/drizzle/0002_furry_iron_lad.sql` — migration: CREATE TABLE team_members + ALTER TABLE tasks ADD mode

---

## Stage 2: API & Port Allocator — Complete

**Status**: Complete

**Changes**:

- `packages/orchestrator/src/routes/tasks.ts`:
  - `POST /api/tasks` — accepts `mode` field, validates `"solo"` | `"team"`, defaults `"solo"`
  - `GET /api/tasks/:id/members` — new endpoint returning `TeamMember[]`
  - `POST /api/tasks/:id/retry` — deletes `team_members` rows before reset
  - `DELETE /api/tasks/:id` — deletes `team_members` rows before alerts/task deletion
- `packages/orchestrator/src/services/port-allocator.ts`:
  - `allocatePort("opencode")` — now also queries `team_members.opencodePort`
  - Added `releaseTeamMemberPort(memberId)`
- `packages/tui/src/lib/api.ts` — `createTask()` accepts `mode`, added `listTeamMembers()`

---

## Stage 3: Lifecycle — Leader Spawn, Plan Parse, Member Spawn — Complete

**Status**: Complete

**Changes**:

- `packages/orchestrator/src/services/opencode.ts`:
  - `processes` Map re-keyed from `worktreePath` to `port` (supports multiple instances per worktree)
  - `stopOpencode(port)` — simplified signature, removed unused `worktreePath` param
- `packages/orchestrator/src/services/lifecycle.ts` — major refactor:
  - `setupTaskInfrastructure()` — extracted shared git/env/db/migration setup
  - `startTask()` — branches on `task.mode` → `startSoloTask()` or `startTeamTask()`
  - `startSoloTask()` — existing solo flow extracted cleanly
  - `COORDINATOR_SYSTEM_PROMPT` — instructs leader to write `.agentco/team-plan.json`
  - `buildMemberPrompt()` — generates role/task/file-specific prompts for members
  - `readTeamPlan()` — reads + validates plan JSON from worktree
  - `startTeamTask()` — spawns leader, inserts `team_members` row, sends coordinator prompt, starts SSE
  - `spawnTeamMembers()` — for each plan member: allocate port, start OpenCode, create session, insert DB row, send prompt, start SSE
  - `buildTeamEventHandler()` — per-member event handler:
    - Leader idle (first time) → parse plan → spawn members → resume leader
    - Member idle → update status → check if all idle → notify leader
    - Leader idle (after synthesis) → task `agent_done` → post-completion analysis
    - All alerts carry `teamMemberId`/`teamMemberLabel` in metadata
  - `updateTeamMemberStatus()` — updates DB + broadcasts `team:member_status` WSEvent

---

## Stage 4: Cleanup, Abort & Reconnect — Complete

**Status**: Complete

**Changes**:

- `packages/orchestrator/src/services/lifecycle.ts`:
  - `stopTeamMembers(taskId)` — shared helper that iterates all team members: stops SSE, aborts session, stops OpenCode, releases port
  - `abortTask()` — calls `stopTeamMembers()` before existing solo cleanup (no-op for solo tasks)
  - `cleanupTask()` — calls `stopTeamMembers()` before existing cleanup. Worktree removal is shared (one remove covers all agents)
  - `reconnectActiveTasks()` — branches on `task.mode`:
    - Solo: existing behavior extracted into `reconnectSoloTask()`
    - Team: `reconnectTeamTask()` — health-checks each member's port, reconnects SSE for living members with `buildTeamEventHandler()`, marks dead members as failed, marks whole task failed if leader is dead

---

## Stage 5: Tmux Multi-Pane Attach — Complete

**Status**: Complete

**Changes**:

- `packages/cli/src/utils/tmux.ts` — added `TeamPaneMember` interface, `openTeamTmuxLayout()`: creates tmux window with leader in first pane, splits each worker horizontally, applies `main-vertical` layout, focuses leader pane
- `packages/tui/src/lib/tmux.ts` — mirrored `TeamPaneMember` + `openTeamTmuxLayout()` 
- `packages/cli/src/commands/task.ts` — `attach` command branches on `match.mode === "team"`: fetches members, filters active, sorts leader-first, calls `openTeamTmuxLayout()`
- `packages/tui/src/views/TaskDetail.tsx` — extracted `canAttach()` helper (team tasks don't need `opencodePort`/`opencodeSessionId` on task), `handleAttach()` branches on team mode to fetch members and open team layout
- `packages/tui/src/views/TaskList.tsx` — added `canAttachTask()` helper, `handleAttach()` branches on team mode with same pattern, key hints show "attach team" for team tasks

---

## Stage 6: TUI & CLI Display — Complete

**Status**: Complete

**Changes**:

- `packages/tui/src/views/TaskCreate.tsx`:
  - Added `mode` field between `model` and `description` in FIELDS array
  - `MODES` constant with Solo/Team options
  - `modeIndex` state + j/k keyboard navigation (same pattern as project/model)
  - Passes selected mode to `api.createTask()`
  - Key hints show "select mode" when mode field is active
- `packages/tui/src/views/TaskList.tsx`:
  - `[team]` badge (accent color) shown after project name for team tasks
- `packages/tui/src/views/TaskDetail.tsx`:
  - `Mode: team` metadata row (accent color) for team tasks
  - "Team Members" section: fetches members via `api.listTeamMembers()` on mount, shows each member's label, status (color-coded), and port
  - Attach key hint shows "attach team" for team tasks
- `packages/cli/src/commands/task.ts`:
  - `create` command: `--team` flag sets `mode: "team"`
  - `list` command: added "Mode" column showing "solo"/"team"

---

## Phase 2: Inter-Agent Communication — Future

Not part of this implementation cycle. Design notes for when we get there:

### Architecture

- Orchestrator-mediated message passing (no direct agent-to-agent)
- Agents write to `.agentco/messages/outbox.jsonl` in the worktree
- Orchestrator detects new messages (fs.watch or check on idle)
- Messages stored in `pendingMessages: Map<memberId, Message[]>` in memory
- Delivered in batch when target agent goes idle via `sendPrompt()`
- No diff checking or annotation — simple routing only

### Message Flow

```
Agent A writes to .agentco/messages/outbox.jsonl:
  { "to": "member-frontend", "content": "..." }

Orchestrator detects → stores in pendingMessages

session.idle fires for member-frontend
  → check pendingMessages["member-frontend"]
  → if messages: bundle into prompt, sendPrompt()
  → if no messages: notify leader "member-frontend is idle"
  → clear queue
```

### Peer-to-Peer Communication

Members can address each other (not just leader). The orchestrator routes based on the `"to"` field.

### Shared Task List

Potentially evolve the static `.agentco/team-plan.json` into a mutable shared task list that members can update (claim tasks, mark done). Lower priority — evaluate after Phase 1 is proven.

---

## Phase 3: Polish — Future

- TUI team member status dashboard
- Task dependency ordering (member B waits for member A)
- Better tmux controls (focus individual member, reattach single pane)
- TeammateIdle / TaskCompleted hooks
