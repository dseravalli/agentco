import { createSignal, createMemo, Show, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useSync } from "../providers/sync.js"
import { useSDK } from "../providers/sdk.js"
import { useRoute } from "../providers/route.js"
import { Header } from "../components/Header.js"
import { KeyHints, type KeyHint } from "../components/KeyHints.js"
import { StatusBadge } from "../components/StatusBadge.js"
import { colors } from "../lib/theme.js"
import { isTmux, openTmuxWindow, openTeamTmuxLayout } from "../lib/tmux.js"
import type { Task, TaskStatus } from "../lib/types.js"

const AGENTCO_URL = process.env.AGENTCO_URL || "http://localhost:8080"

export function TaskList() {
  const { state, status, refresh } = useSync()
  const { api } = useSDK()
  const { navigate } = useRoute()
  const [message, setMessage] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  const [filter, setFilter] = createSignal("")
  const [filterActive, setFilterActive] = createSignal(false)
  const [actionInProgress, setActionInProgress] = createSignal<string | null>(null)
  const [mode, setMode] = createSignal<
    | { type: "normal" }
    | { type: "confirm"; action: string; onConfirm: () => void }
  >({ type: "normal" })

  const projectMap = createMemo(() => {
    const map = new Map<string, string>()
    for (const p of state.projects) {
      map.set(p.id, p.name)
    }
    return map
  })

  const unreadByTask = createMemo(() => {
    const map = new Map<string, number>()
    for (const a of state.alerts) {
      if (!a.read) {
        map.set(a.taskId, (map.get(a.taskId) || 0) + 1)
      }
    }
    return map
  })

  const actionRequiredByTask = createMemo(() => {
    const map = new Map<string, number>()
    for (const a of state.alerts) {
      if (!a.read && a.type === "action_required") {
        map.set(a.taskId, (map.get(a.taskId) || 0) + 1)
      }
    }
    return map
  })

  const sortedTasks = createMemo(() =>
    [...state.tasks].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  )

  const filteredTasks = createMemo(() => {
    const f = filter().toLowerCase()
    if (!f) return sortedTasks()
    return sortedTasks().filter((task) => {
      const projName = projectMap().get(task.projectId) || ""
      return (
        task.title.toLowerCase().includes(f) ||
        task.status.toLowerCase().includes(f) ||
        projName.toLowerCase().includes(f)
      )
    })
  })

  const selectedTask = createMemo(() => filteredTasks()[cursor()])

  function clampCursor() {
    const max = filteredTasks().length - 1
    if (cursor() > max) setCursor(Math.max(0, max))
  }

  const ATTACHABLE: TaskStatus[] = ["agent_running", "needs_input", "plan_ready", "agent_done", "preview_live"]

  function showMessage(msg: string) {
    setMessage(msg)
    setTimeout(() => setMessage(""), 3000)
  }

  async function doAction(label: string, fn: () => Promise<void>) {
    setActionInProgress(label)
    try {
      await fn()
      showMessage(`${label}: ok`)
      await refresh()
    } catch (err) {
      showMessage(`${label}: ${(err as Error).message}`)
    } finally {
      setActionInProgress(null)
    }
  }

  function confirmAction(action: string, onConfirm: () => void) {
    setMode({ type: "confirm", action, onConfirm })
  }

  function canAttachTask(t: Task): boolean {
    if (!ATTACHABLE.includes(t.status)) return false
    if (t.mode === "team") return true
    return t.opencodePort !== null && t.opencodeSessionId !== null
  }

  async function handleAttach() {
    const t = selectedTask()
    if (!t || !canAttachTask(t)) return
    if (!isTmux()) {
      showMessage("Not in a tmux session")
      return
    }

    if (t.mode === "team") {
      try {
        const members = await api.listTeamMembers(t.id)
        const active = members.filter(
          (m) => m.opencodePort && m.opencodeSessionId
        )
        if (active.length === 0) {
          showMessage("No team members with active sessions")
          return
        }
        const sorted = [
          ...active.filter((m) => m.role === "leader"),
          ...active.filter((m) => m.role === "member"),
        ]
        openTeamTmuxLayout(
          `team-${t.slug}`,
          sorted.map((m) => ({
            serverUrl: `http://127.0.0.1:${m.opencodePort}`,
            sessionId: m.opencodeSessionId!,
            label: m.label,
          }))
        )
        showMessage("Opened team tmux layout")
      } catch (err) {
        showMessage(`Attach failed: ${(err as Error).message}`)
      }
    } else {
      openTmuxWindow(`oc-${t.slug}`, `http://127.0.0.1:${t.opencodePort}`, t.opencodeSessionId!)
      showMessage("Opened tmux window")
    }
  }

  useKeyboard((key) => {
    if (actionInProgress()) return

    const m = mode()
    if (m.type === "confirm") {
      if (key.name === "y" || key.name === "return") {
        m.onConfirm()
        setMode({ type: "normal" })
      } else {
        setMode({ type: "normal" })
        showMessage("Cancelled")
      }
      return
    }

    if (filterActive()) {
      if (key.name === "escape") {
        setFilterActive(false)
        setFilter("")
        return
      }
      if (key.name === "return") {
        setFilterActive(false)
        return
      }
      if (key.name === "backspace") {
        setFilter((f) => f.slice(0, -1))
        clampCursor()
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setFilter((f) => f + key.sequence)
        setCursor(0)
        return
      }
      return
    }

    // Normal mode
    if (key.ctrl && key.name === "c") {
      process.exit(0)
    }
    if (key.name === "j" || key.name === "down") {
      setCursor((c) => Math.min(c + 1, filteredTasks().length - 1))
    }
    if (key.name === "k" || key.name === "up") {
      setCursor((c) => Math.max(c - 1, 0))
    }
    if (key.name === "g") {
      setCursor(0)
    }
    if (key.shift && key.name === "g") {
      setCursor(Math.max(0, filteredTasks().length - 1))
    }
    if (key.name === "return") {
      const task = selectedTask()
      if (task) {
        navigate({ name: "task-detail", taskId: task.id })
      }
    }
    if (key.name === "c") {
      navigate({ name: "task-create" })
    }
    if (key.name === "/") {
      setFilterActive(true)
      setFilter("")
    }

    // Task actions on selected task
    const t = selectedTask()
    if (t) {
      if (key.name === "a") {
        handleAttach()
        return
      }
      if (key.name === "s" && t.status === "pending") {
        doAction("start", () => api.startTask(t.id))
        return
      }
      if (key.name === "x" && t.status !== "archived" && t.status !== "aborted" && t.status !== "failed") {
        confirmAction("Abort task?", () => doAction("abort", () => api.abortTask(t.id)))
        return
      }
    }

    if (key.name === "escape") {
      if (filter()) {
        setFilter("")
        clampCursor()
      }
    }
  })

  const keyHints = createMemo((): KeyHint[] => {
    const action = actionInProgress()
    if (action) {
      return [{ key: "...", label: action }]
    }

    const m = mode()
    if (m.type === "confirm") {
      return [
        { key: "y/enter", label: "confirm" },
        { key: "any", label: "cancel" },
      ]
    }

    if (filterActive()) {
      return [
        { key: "esc", label: "cancel" },
        { key: "enter", label: "apply" },
      ]
    }
    const hints: KeyHint[] = [
      { key: "j/k", label: "navigate" },
      { key: "enter", label: "detail" },
    ]
    const t = selectedTask()
    if (t) {
      if (canAttachTask(t))
        hints.push({ key: "a", label: t.mode === "team" ? "attach team" : "attach" })
      if (t.status === "pending") hints.push({ key: "s", label: "start" })
      if (t.status !== "archived" && t.status !== "aborted" && t.status !== "failed")
        hints.push({ key: "x", label: "abort" })
    }
    hints.push(
      { key: "c", label: "create" },
      { key: "/", label: "filter" },
    )
    return hints
  })

  return (
    <box width="100%" height="100%" flexDirection="column">
      <Header status={status} baseUrl={AGENTCO_URL} />
      <box
        borderStyle="rounded"
        borderColor={colors.border}
        width="100%"
        flexGrow={1}
        flexDirection="column"
        paddingX={1}
      >
        <Show when={filterActive() || filter()}>
          <box width="100%" height={1} flexDirection="row" gap={1}>
            <text fg={colors.accent}>/</text>
            <text fg={colors.text}>{filter()}</text>
            <Show when={filterActive()}>
              <text fg={colors.textMuted}>_</text>
            </Show>
          </box>
        </Show>
        <Show
          when={filteredTasks().length > 0}
          fallback={
            <text fg={status() === "error" || status() === "disconnected" ? colors.error : colors.textDim}>
              {status() === "loading"
                ? "Loading..."
                : status() === "error" || status() === "disconnected"
                  ? "Cannot connect to orchestrator"
                  : filter()
                    ? "No matching tasks."
                    : "No tasks yet. Press c to create one."}
            </text>
          }
        >
          <For each={filteredTasks()}>
            {(task: Task, i) => {
              const isSelected = () => i() === cursor()
              const projName = () => projectMap().get(task.projectId) || "???"
              const alertCount = () => unreadByTask().get(task.id) || 0
              const actionCount = () => actionRequiredByTask().get(task.id) || 0

              return (
                <box
                  flexDirection="row"
                  width="100%"
                  gap={1}
                  backgroundColor={isSelected() ? colors.highlight : undefined}
                >
                  <text fg={isSelected() ? colors.accent : colors.textMuted}>
                    {isSelected() ? ">" : " "}
                  </text>
                  <text fg={colors.textMuted}>[{projName()}]</text>
                  <Show when={task.mode === "team"}>
                    <text fg={colors.accent}>[team]</text>
                  </Show>
                  <text fg={alertCount() > 0 ? colors.warning : "transparent"}>
                    {alertCount() > 0 ? "*" : " "}
                  </text>
                  <text fg={isSelected() ? colors.highlightText : colors.text} flexGrow={1}>
                    {task.title}
                  </text>
                  <Show when={actionCount() > 0}>
                    <text fg="#d19a66">{actionCount()} action{actionCount() > 1 ? "s" : ""}</text>
                  </Show>
                  <StatusBadge status={task.status} />
                </box>
              )
            }}
          </For>
        </Show>
        <Show when={mode().type === "confirm"}>
          <text fg={colors.warning}>{(mode() as { action: string }).action}</text>
        </Show>
        <Show when={actionInProgress()}>
          {(action) => <text fg={colors.accent}>{action()}...</text>}
        </Show>
        <Show when={message()}>
          <text fg={colors.textDim}>{message()}</text>
        </Show>
      </box>
      <KeyHints hints={keyHints()} />
    </box>
  )
}
