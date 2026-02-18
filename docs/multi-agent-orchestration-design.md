# Multi-Agent Orchestration System Design

## Context

Design notes for building a multi-agent coding system using OpenCode CLI, modeled after Claude Code Agent Teams architecture. This builds on existing AgentCo infrastructure for agent lifecycle management.

---

## Claude Code Agent Teams — Reference Architecture

Claude Code Agent Teams is an experimental feature (as of Feb 2026) that orchestrates multiple Claude Code instances working in parallel.

### How It Works

- One session acts as the **team lead**, coordinating work, assigning tasks, and synthesizing results.
- **Teammates work independently**, each in its own context window, and communicate directly with each other.
- Unlike subagents (which run within a single session and can only report back to the main agent), you can interact with individual teammates directly without going through the lead.
- The team shares a task list. Teammate messages arrive at the lead automatically.

### Spawning

- You request a team by giving Claude a task that benefits from parallel work and explicitly asking for an agent team. Claude creates one based on your instructions.
- Claude may also propose a team if it determines the task would benefit from parallel work. You confirm before it proceeds.

### Hooks

- **TeammateIdle**: Runs when a teammate is about to go idle. Exit with code 2 to send feedback and keep the teammate working.
- **TaskCompleted**: Runs when a task is being marked complete. Exit with code 2 to prevent completion and send feedback.

### File Ownership

Claude Code Agent Teams has **no file locking, no merge resolution, and no enforcement layer**. File ownership is purely prompt-level — the coordinator assigns files in the task plan, agents are expected to comply. Two teammates editing the same file leads to overwrites.

---

## System Design for OpenCode-Based Implementation

### High-Level Flow

1. **Coordinator agent** receives task description.
2. Coordinator is prompted to decompose the task into a **team plan** — a markdown file containing a task list, team assignments, roles, and file ownership.
3. Coordinator **spawns worker agents** via OpenCode CLI, passing each agent its role, assigned tasks, and constraints.
4. Workers execute in parallel with **inter-agent communication** for coordination.
5. Coordinator **synthesizes results** and handles merging.

### Requirements for the Agent CLI (OpenCode)

The CLI must support:

- **Headless/non-interactive mode**: Accept an initial prompt/instruction without TTY interaction, or at minimum accept piped input.
- **Retrievable output**: Write output somewhere the orchestration layer can read.
- **Clean exit codes**: Signal completion vs. failure programmatically.

If the CLI is purely interactive/REPL-style with no headless mode, the orchestration layer will be fighting the tool constantly.

---

## Key Technical Challenges

### 1. Inter-Agent Communication

**Problem**: Agents need to share findings, request information, and coordinate without a shared context window.

**Simplest viable approach**: A shared directory where each agent has an inbox file. Agents poll their inbox on a loop or between tool calls. The coordinator writes to inboxes. Agents can write to each other's inboxes. Filesystem-based, no infrastructure required. Claude Code Agent Teams does a version of this internally.

**Important constraint**: Every status check, message read, and plan re-read burns tokens from the agent's context window. Keep messages terse and structured (JSON, not prose).

### 2. File Ownership Partitioning

**Problem**: Two agents editing the same file causes corruption/overwrites.

**Option A — Prompt-only (same as Claude Teams)**: Coordinator assigns files per agent in the plan markdown. Agents are instructed not to touch other agents' files. Works surprisingly well in practice but will occasionally fail. No technical enforcement.

**Option B — Filesystem enforcement**: Give each agent a working directory. They can read the full repo but only write to their assigned paths. Symlink or copy shared dependencies in. Merge back to main at the end via the coordinator. More robust but adds orchestration complexity.

**Option C — Git branch per agent (recommended)**: Each agent works on its own branch. Coordinator merges branches at the end, resolving conflicts. Most resilient approach — plays well with existing tooling. The merge step can itself be delegated to an agent. If OpenCode supports git operations, agents don't need any special capability beyond working on the correct branch.

### 3. Task Dependency Ordering

**Problem**: Not everything is parallelizable. Agent B might need Agent A's output.

The task plan must express dependencies explicitly. The coordinator needs to gate spawning or signal agents to wait until upstream tasks complete.

### 4. Agent Lifecycle Management

**Problem**: Spawning is easy. Knowing when an agent is done, stuck, or has crashed is harder.

Need a way to poll or receive signals for agent state: idle, working, completed, errored. If the CLI doesn't expose this natively, options include parsing stdout/stderr or polling a side-channel (file, socket, etc.).

**Note**: AgentCo already handles single-agent lifecycle. The extension needed is multi-agent state tracking with the coordinator aware of all worker states simultaneously.

### 5. Context Window Overhead

Coordination overhead eats into agent context windows. Every status check, every message read, every plan re-read consumes tokens. Design implications:

- Keep inter-agent messages structured and minimal (JSON over prose).
- Front-load context at spawn time rather than requiring agents to repeatedly re-read the plan.
- Prefer fire-and-forget task assignment over continuous polling where possible.

---

## Recommended Starting Tasks

Start with tasks that have clear boundaries and don't require code changes: reviewing a PR, researching a library, or investigating a bug. These demonstrate the value of parallel exploration without the coordination challenges of parallel implementation.

---

## Architecture Summary

```
┌─────────────────────────────────────────────┐
│              Orchestration Layer             │
│         (AgentCo + new multi-agent)         │
├─────────────────────────────────────────────┤
│                                             │
│  ┌───────────┐    Task Plan (MD)            │
│  │Coordinator│──────────────────────┐       │
│  │  Agent    │                      │       │
│  └─────┬─────┘                      │       │
│        │ spawns                     │       │
│   ┌────┼────┬───────────┐           │       │
│   │    │    │           │           │       │
│   ▼    ▼    ▼           ▼           ▼       │
│ ┌────┐┌────┐┌────┐  ┌────┐  ┌───────────┐  │
│ │Agt1││Agt2││Agt3│  │AgtN│  │Shared Dir │  │
│ │    ││    ││    │  │    │  │ - inboxes │  │
│ │git ││git ││git │  │git │  │ - task md │  │
│ │br-1││br-2││br-3│  │br-N│  │ - outputs │  │
│ └────┘└────┘└────┘  └────┘  └───────────┘  │
│                                             │
│        Git merge ← Coordinator              │
└─────────────────────────────────────────────┘
```

---

## Open Questions

- How does OpenCode handle headless spawning and exit signaling?
- What's the optimal polling interval for inbox checks vs. context window cost?
- Should the coordinator run as a persistent process or be re-invoked periodically?
- How to handle agent failure mid-task — retry, reassign, or escalate?
