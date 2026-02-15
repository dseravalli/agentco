import { useKeyboard } from "@opentui/solid"
import { createSignal, createMemo, Show, For } from "solid-js"
import { useSync } from "../providers/sync.js"
import { useSDK } from "../providers/sdk.js"
import { useRoute } from "../providers/route.js"
import { Header } from "../components/Header.js"
import { KeyHints, type KeyHint } from "../components/KeyHints.js"
import { StatusBadge } from "../components/StatusBadge.js"
import { colors } from "../lib/theme.js"
import { timeAgo } from "../lib/time.js"
import { isTmux, openTmuxWindow } from "../lib/tmux.js"
import type { Alert, Task, TaskStatus } from "../lib/types.js"

const AGENTCO_URL = process.env.AGENTCO_URL || "http://localhost:8080"

type Mode =
  | { type: "normal" }
  | { type: "confirm"; action: string; onConfirm: () => void }

const ATTACHABLE: TaskStatus[] = ["agent_running", "needs_input", "plan_ready", "agent_done", "preview_live"]

function canAttach(task: Task): boolean {
  return (
    ATTACHABLE.includes(task.status) &&
    task.opencodePort !== null &&
    task.opencodeSessionId !== null
  )
}

function MetadataRow(props: { label: string; value: string; valueFg?: string }) {
  return (
    <box flexDirection="row" gap={1}>
      <text fg={colors.textMuted} width={12}>{props.label}</text>
      <text fg={props.valueFg || colors.text}>{props.value}</text>
    </box>
  )
}

function AlertRow(props: {
  alert: Alert
  isActive: boolean
}) {
  const icon = () => {
    switch (props.alert.type) {
      case "needs_permission":
      case "needs_input":
        return "!"
      case "needs_question":
        return "?"
      case "error":
        return "x"
      default:
        return "i"
    }
  }

  const fg = () => {
    switch (props.alert.type) {
      case "needs_permission":
      case "needs_input":
        return colors.warning
      case "needs_question":
        return colors.accent
      case "error":
        return colors.error
      default:
        return colors.textDim
    }
  }

  return (
    <box flexDirection="row" width="100%" gap={1} backgroundColor={props.isActive ? colors.highlight : undefined}>
      <text fg={fg()}>{icon()}</text>
      <text fg={props.isActive ? colors.highlightText : colors.text} flexGrow={1}>
        {props.alert.message}
      </text>
      <text fg={colors.textMuted}>{timeAgo(props.alert.createdAt)}</text>
    </box>
  )
}

export function TaskDetail(props: { taskId: string }) {
  const { state, status, refresh } = useSync()
  const { api } = useSDK()
  const { back } = useRoute()
  const [mode, setMode] = createSignal<Mode>({ type: "normal" })
  const [alertCursor, setAlertCursor] = createSignal(0)
  const [message, setMessage] = createSignal("")
  const [actionInProgress, setActionInProgress] = createSignal<string | null>(null)

  const task = createMemo(() => state.tasks.find((t) => t.id === props.taskId))
  const project = createMemo(() => {
    const t = task()
    if (!t) return undefined
    return state.projects.find((p) => p.id === t.projectId)
  })

  const taskAlerts = createMemo(() =>
    state.alerts
      .filter((a) => a.taskId === props.taskId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  )

  const unreadAlerts = createMemo(() => taskAlerts().filter((a) => !a.read))

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

  function handleAttach() {
    const t = task()
    if (!t || !canAttach(t)) return

    if (!isTmux()) {
      showMessage("Not in a tmux session")
      return
    }

    openTmuxWindow(
      `oc-${t.slug}`,
      `http://127.0.0.1:${t.opencodePort}`,
      t.opencodeSessionId!
    )
    showMessage("Opened tmux window")
  }

  useKeyboard((key) => {
    if (actionInProgress()) return

    const m = mode()

    // Confirm dialog mode
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

    // Normal mode
    if (key.name === "escape" || key.name === "backspace") {
      back()
      return
    }
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      process.exit(0)
    }

    const t = task()
    if (!t) return

    // Alert navigation
    if (key.name === "j" || key.name === "down") {
      setAlertCursor((c) => Math.min(c + 1, taskAlerts().length - 1))
    }
    if (key.name === "k" || key.name === "up") {
      setAlertCursor((c) => Math.max(c - 1, 0))
    }

    // Task lifecycle actions
    if (key.name === "a" && canAttach(t)) {
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
    if (key.name === "r" && (t.status === "failed" || t.status === "aborted")) {
      doAction("retry", () => api.retryTask(t.id))
      return
    }
    if (key.name === "p" && t.status === "agent_done") {
      doAction("create PR", () => api.createPR(t.id).then(() => {}))
      return
    }
    if (key.name === "d") {
      if (t.status === "archived" || t.status === "pending") {
        confirmAction("Delete task?", () => {
          doAction("delete", () => api.deleteTask(t.id)).then(() => back())
        })
      } else {
        confirmAction("Cleanup task?", () => {
          doAction("cleanup", () => api.cleanupTask(t.id))
        })
      }
      return
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
    const t = task()
    const hints: KeyHint[] = [{ key: "esc", label: "back" }]

    if (t) {
      if (canAttach(t)) hints.push({ key: "a", label: "attach" })
      if (t.status === "pending") hints.push({ key: "s", label: "start" })
      if (t.status !== "archived" && t.status !== "aborted" && t.status !== "failed")
        hints.push({ key: "x", label: "abort" })
      if (t.status === "failed" || t.status === "aborted") hints.push({ key: "r", label: "retry" })
      if (t.status === "agent_done") hints.push({ key: "p", label: "pr" })
      hints.push({ key: "d", label: t.status === "archived" || t.status === "pending" ? "delete" : "cleanup" })
    }

    if (taskAlerts().length > 0) {
      hints.push({ key: "j/k", label: "alerts" })
    }
    hints.push({ key: "q", label: "quit" })
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
        paddingY={1}
      >
        <Show when={task()} fallback={<text fg={colors.error}>Task not found.</text>}>
          {(t) => (
            <box flexDirection="column" width="100%" gap={1}>
              {/* Title + status */}
              <box flexDirection="row" gap={1}>
                <text fg={colors.highlightText}><b>{t().title}</b></text>
                <StatusBadge status={t().status} />
              </box>

              {/* Metadata */}
              <box flexDirection="column">
                <MetadataRow label="Project" value={project()?.name || "???"} />
                <MetadataRow label="ID" value={t().id.slice(0, 8)} valueFg={colors.textMuted} />
                <Show when={t().branchName}>
                  <MetadataRow label="Branch" value={t().branchName!} />
                </Show>
                <Show when={t().opencodePort}>
                  <MetadataRow label="Agent port" value={String(t().opencodePort)} />
                </Show>
                <Show when={t().devPreviewPort}>
                  <MetadataRow label="Preview" value={`http://localhost:${t().devPreviewPort}`} />
                </Show>
                <Show when={t().prUrl}>
                  <MetadataRow label="PR" value={t().prUrl!} valueFg={colors.accent} />
                </Show>
                <MetadataRow label="Created" value={timeAgo(t().createdAt)} />
                <MetadataRow label="Updated" value={timeAgo(t().updatedAt)} />
              </box>

              {/* Error */}
              <Show when={t().error}>
                <box flexDirection="column">
                  <text fg={colors.error}><b>Error</b></text>
                  <text fg={colors.error}>{t().error}</text>
                </box>
              </Show>

              {/* Alerts */}
              <Show when={taskAlerts().length > 0}>
                <box flexDirection="column" width="100%">
                  <text fg={colors.textDim}>
                    Alerts ({unreadAlerts().length} unread)
                  </text>
                  <For each={taskAlerts()}>
                    {(alert, i) => (
                      <AlertRow
                        alert={alert}
                        isActive={i() === alertCursor()}
                      />
                    )}
                  </For>
                </box>
              </Show>

              {/* Confirm dialog */}
              <Show when={mode().type === "confirm"}>
                <box flexDirection="row" gap={1}>
                  <text fg={colors.warning}><b>{(mode() as { action: string }).action}</b></text>
                  <text fg={colors.textDim}>(y/enter to confirm, any key to cancel)</text>
                </box>
              </Show>

              {/* Loading / feedback message */}
              <Show when={actionInProgress()}>
                {(action) => <text fg={colors.accent}>{action()}...</text>}
              </Show>
              <Show when={message()}>
                <text fg={colors.textDim}>{message()}</text>
              </Show>
            </box>
          )}
        </Show>
      </box>
      <KeyHints hints={keyHints()} />
    </box>
  )
}
