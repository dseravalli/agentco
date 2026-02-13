skip
└─ Director Agent (strategy + orchestration)
├─ PM Agent: Project A
│ ├─ Coding agents
│ ├─ Marketing agent
│ └─ Research agent
├─ PM Agent: Project B
│ └─ ...
└─ PM Agent: Project C

- A chat interface where I can @ different agents. @Director, @Project1PM, etc
- Agent accessible persistant storage of tasks/tickets
- Agents post into chat when something needs my attention:
  - PR ready for review
  - Plan ready for preview (code or otherwise)
  - Questions need answering (opencode plan mode or otherwise)
  - Errors (usage limits, APIs down, database access bad, etc)
- Place where I write documents

https://docs.openclaw.ai/start/getting-started
https://github.com/badlogic/pi-mono

First Piece:

- Some kind of web UI or TUI that organizes projects, tasks, and agents working on tasks
- I define and start a task and this happens:
  - Shell started
  - Git pull main
  - Create worktree
  - Start opencode session and pass task in plan mode
  - I get alerted on the dashboard when i need to provide input in a agent session
  - When agent consider itself done in build mode, it submits a PR and alerts me about it, ideally with a dev env i can view
