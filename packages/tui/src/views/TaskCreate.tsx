import { useKeyboard } from "@opentui/solid"
import { createSignal, createMemo, Show, For } from "solid-js"
import { useSync } from "../providers/sync.js"
import { useSDK } from "../providers/sdk.js"
import { useRoute } from "../providers/route.js"
import { useToast } from "../providers/toast.js"
import { Header } from "../components/Header.js"
import { KeyHints, type KeyHint } from "../components/KeyHints.js"
import { colors } from "../lib/theme.js"

const AGENTCO_URL = process.env.AGENTCO_URL || "http://localhost:8080"

type Field = "project" | "title" | "description"
const FIELDS: Field[] = ["project", "title", "description"]

export function TaskCreate() {
  const { state, status, refresh } = useSync()
  const { api } = useSDK()
  const { back, navigate } = useRoute()
  const toast = useToast()

  const [activeField, setActiveField] = createSignal<Field>("project")
  const [projectIndex, setProjectIndex] = createSignal(0)
  const [title, setTitle] = createSignal("")
  const [description, setDescription] = createSignal("")
  const [message, setMessage] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  const projects = createMemo(() => state.projects)
  const selectedProject = createMemo(() => projects()[projectIndex()])

  function showMessage(msg: string) {
    setMessage(msg)
    setTimeout(() => setMessage(""), 3000)
  }

  function nextField() {
    const idx = FIELDS.indexOf(activeField())
    if (idx < FIELDS.length - 1) {
      setActiveField(FIELDS[idx + 1])
    }
  }

  function prevField() {
    const idx = FIELDS.indexOf(activeField())
    if (idx > 0) {
      setActiveField(FIELDS[idx - 1])
    }
  }

  async function submit(andStart: boolean) {
    const proj = selectedProject()
    if (!proj) {
      showMessage("No project selected")
      return
    }
    if (!title().trim()) {
      showMessage("Title is required")
      setActiveField("title")
      return
    }

    setSubmitting(true)
    try {
      const task = await api.createTask(proj.id, title().trim(), description().trim())
      if (andStart) {
        await api.startTask(task.id)
        toast.show("Task created and started")
      } else {
        toast.show("Task created")
      }
      await refresh()
      navigate({ name: "task-detail", taskId: task.id })
    } catch (err) {
      showMessage(`Error: ${(err as Error).message}`)
      setSubmitting(false)
    }
  }

  useKeyboard((key) => {
    if (submitting()) return

    // Global
    if (key.name === "escape") {
      back()
      return
    }
    if (key.ctrl && key.name === "c") {
      process.exit(0)
    }

    // Submit
    if (key.ctrl && key.name === "s") {
      submit(true)
      return
    }
    if (key.ctrl && key.name === "return") {
      submit(false)
      return
    }

    // Tab navigation
    if (key.name === "tab") {
      if (key.shift) {
        prevField()
      } else {
        nextField()
      }
      return
    }

    const field = activeField()

    // Project selector
    if (field === "project") {
      if (key.name === "j" || key.name === "down" || key.name === "right") {
        setProjectIndex((i) => Math.min(i + 1, projects().length - 1))
        return
      }
      if (key.name === "k" || key.name === "up" || key.name === "left") {
        setProjectIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (key.name === "return") {
        nextField()
        return
      }
      return
    }

    // Text input fields (title and description)
    const [getter, setter] = field === "title"
      ? [title, setTitle] as const
      : [description, setDescription] as const

    if (key.name === "backspace") {
      setter((v) => v.slice(0, -1))
      return
    }
    if (key.name === "return" && field === "title") {
      nextField()
      return
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setter((v) => v + key.sequence)
      return
    }
  })

  function FieldLabel(props: { label: string; field: Field }) {
    const isActive = () => activeField() === props.field
    return (
      <text fg={isActive() ? colors.accent : colors.textMuted} width={14}>
        {isActive() ? "> " : "  "}{props.label}
      </text>
    )
  }

  const keyHints = createMemo((): KeyHint[] => {
    if (submitting()) {
      return [{ key: "...", label: "creating" }]
    }
    const hints: KeyHint[] = [{ key: "esc", label: "cancel" }]
    hints.push({ key: "tab", label: "next field" })
    if (activeField() === "project") {
      hints.push({ key: "j/k", label: "select project" })
    }
    hints.push(
      { key: "ctrl+s", label: "create & start" },
      { key: "ctrl+enter", label: "create only" },
    )
    return hints
  })

  return (
    <box width="100%" height="100%" flexDirection="column">
      <Header status={status} baseUrl={AGENTCO_URL} />
      <box
        borderStyle="rounded"
        borderColor={colors.border}
        title="New Task"
        titleAlignment="center"
        width="100%"
        flexGrow={1}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
      >
        <Show
          when={projects().length > 0}
          fallback={
            <text fg={colors.error}>
              No projects registered. Use `agentco project create` first.
            </text>
          }
        >
          {/* Project selector */}
          <box flexDirection="row" width="100%" gap={1}>
            <FieldLabel label="Project" field="project" />
            <box flexDirection="row" gap={1}>
              <Show when={activeField() === "project"}>
                <text fg={colors.textMuted}>{"<"}</text>
              </Show>
              <text fg={activeField() === "project" ? colors.highlightText : colors.text}>
                {selectedProject()?.name || "---"}
              </text>
              <Show when={activeField() === "project"}>
                <text fg={colors.textMuted}>{">"}</text>
              </Show>
              <Show when={activeField() === "project" && projects().length > 1}>
                <text fg={colors.textMuted}>
                  ({projectIndex() + 1}/{projects().length})
                </text>
              </Show>
            </box>
          </box>

          {/* Title input */}
          <box flexDirection="row" width="100%" gap={1}>
            <FieldLabel label="Title" field="title" />
            <box flexDirection="row" flexGrow={1}>
              <Show
                when={title()}
                fallback={
                  <text fg={activeField() === "title" ? colors.textMuted : colors.textMuted}>
                    {activeField() === "title" ? "_" : "enter a title..."}
                  </text>
                }
              >
                <text fg={activeField() === "title" ? colors.highlightText : colors.text}>
                  {title()}
                </text>
                <Show when={activeField() === "title"}>
                  <text fg={colors.textMuted}>_</text>
                </Show>
              </Show>
            </box>
          </box>

          {/* Description input */}
          <box flexDirection="row" width="100%" gap={1}>
            <FieldLabel label="Description" field="description" />
            <box flexDirection="row" flexGrow={1}>
              <Show
                when={description()}
                fallback={
                  <text fg={activeField() === "description" ? colors.textMuted : colors.textMuted}>
                    {activeField() === "description" ? "_" : "(optional)"}
                  </text>
                }
              >
                <text fg={activeField() === "description" ? colors.highlightText : colors.text}>
                  {description()}
                </text>
                <Show when={activeField() === "description"}>
                  <text fg={colors.textMuted}>_</text>
                </Show>
              </Show>
            </box>
          </box>

          {/* Feedback */}
          <Show when={message()}>
            <box paddingTop={1}>
              <text fg={colors.warning}>{message()}</text>
            </box>
          </Show>

          <Show when={submitting()}>
            <box paddingTop={1}>
              <text fg={colors.accent}>Creating task...</text>
            </box>
          </Show>
        </Show>
      </box>
      <KeyHints hints={keyHints()} />
    </box>
  )
}
