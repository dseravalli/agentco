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
  | { type: "respond"; alertId: string; input: string }

const ATTACHABLE: TaskStatus[] = ["agent_running", "needs_input", "agent_done", "preview_live"]

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
  mode: Mode
  onStartRespond: () => void
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

  const isResponding = () =>
    props.mode.type === "respond" && props.mode.alertId === props.alert.id

  return (
    <box flexDirection="column" width="100%">
      <box
        flexDirection="row"
        width="100%"
        gap={1}
        backgroundColor={props.isActive ? colors.highlight : undefined}
      >
        <text fg={fg()}>{icon()}</text>
        <text fg={props.isActive ? colors.highlightText : colors.text} flexGrow={1}>
          {props.alert.message}
        </text>
        <text fg={colors.textMuted}>{timeAgo(props.alert.createdAt)}</text>
      </box>
      <Show when={props.isActive && !props.alert.read}>
        <Show when={props.alert.type === "needs_permission" || props.alert.type === "needs_input"}>
          <box flexDirection="row" gap={2} paddingLeft={2}>
            <text>
              <span fg={colors.key}>a</span>
              <span fg={colors.keyLabel}> approve</span>
            </text>
            <text>
              <span fg={colors.key}>d</span>
              <span fg={colors.keyLabel}> deny</span>
            </text>
          </box>
        </Show>
        <Show when={props.alert.type === "needs_question"}>
          <Show
            when={isResponding()}
            fallback={
              <box paddingLeft={2}>
                <text>
                  <span fg={colors.key}>t</span>
                  <span fg={colors.keyLabel}> type response</span>
                </text>
              </box>
            }
          >
            <box flexDirection="row" gap={1} paddingLeft={2}>
              <text fg={colors.accent}>{">"}</text>
              <text fg={colors.text}>
                {(props.mode as { input: string }).input}
              </text>
              <text fg={colors.textMuted}>_</text>
            </box>
          </Show>
        </Show>
      </Show>
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
  const activeAlert = createMemo(() => taskAlerts()[alertCursor()])

  function showMessage(msg: string) {
    setMessage(msg)
    setTimeout(() => setMessage(""), 3000)
  }

  async function doAction(label: string, fn: () => Promise<void>) {
    try {
      await fn()
      showMessage(`${label}: ok`)
      await refresh()
    } catch (err) {
      showMessage(`${label}: ${(err as Error).message}`)
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

  async function handleAlertAction(action: "approve" | "deny") {
    const alert = activeAlert()
    if (!alert || alert.read) return
    await doAction(action, () => api.respondToAlert(alert.id, action))
  }

  async function handleQuestionSubmit(input: string) {
    const alert = activeAlert()
    if (!alert) return
    await doAction("respond", () => api.respondToAlert(alert.id, "approve", [[input]]))
    setMode({ type: "normal" })
  }

  useKeyboard((key) => {
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

    // Text input mode for question responses
    if (m.type === "respond") {
      if (key.name === "escape") {
        setMode({ type: "normal" })
        return
      }
      if (key.name === "return") {
        if (m.input.trim()) {
          handleQuestionSubmit(m.input.trim())
        }
        return
      }
      if (key.name === "backspace") {
        setMode({ type: "respond", alertId: m.alertId, input: m.input.slice(0, -1) })
        return
      }
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setMode({ type: "respond", alertId: m.alertId, input: m.input + key.sequence })
        return
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

    // Alert actions on active alert
    const alert = activeAlert()
    if (alert && !alert.read) {
      if (key.name === "a" && (alert.type === "needs_permission" || alert.type === "needs_input")) {
        handleAlertAction("approve")
        return
      }
      if (key.name === "d" && (alert.type === "needs_permission" || alert.type === "needs_input")) {
        handleAlertAction("deny")
        return
      }
      if (key.name === "t" && alert.type === "needs_question") {
        setMode({ type: "respond", alertId: alert.id, input: "" })
        return
      }
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
    if (key.name === "x" && (t.status === "agent_running" || t.status === "needs_input")) {
      confirmAction("Abort task?", () => doAction("abort", () => api.abortTask(t.id)))
      return
    }
    if (key.name === "r" && t.status === "failed") {
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
    const m = mode()
    if (m.type === "confirm") {
      return [
        { key: "y/enter", label: "confirm" },
        { key: "any", label: "cancel" },
      ]
    }
    if (m.type === "respond") {
      return [
        { key: "enter", label: "send" },
        { key: "esc", label: "cancel" },
      ]
    }

    const t = task()
    const hints: KeyHint[] = [{ key: "esc", label: "back" }]

    if (t) {
      if (canAttach(t)) hints.push({ key: "a", label: "attach" })
      if (t.status === "pending") hints.push({ key: "s", label: "start" })
      if (t.status === "agent_running" || t.status === "needs_input")
        hints.push({ key: "x", label: "abort" })
      if (t.status === "failed") hints.push({ key: "r", label: "retry" })
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
                        mode={mode()}
                        onStartRespond={() =>
                          setMode({ type: "respond", alertId: alert.id, input: "" })
                        }
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

              {/* Feedback message */}
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
