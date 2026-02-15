import { useKeyboard, useRenderer } from "@opentui/solid"
import { createSignal, createMemo, onMount, Show } from "solid-js"
import { spawnSync } from "node:child_process"
import { writeFileSync, readFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { useSync } from "../providers/sync.js"
import { useSDK } from "../providers/sdk.js"
import { useRoute } from "../providers/route.js"
import { useToast } from "../providers/toast.js"
import { Header } from "../components/Header.js"
import { KeyHints, type KeyHint } from "../components/KeyHints.js"
import { colors } from "../lib/theme.js"

const AGENTCO_URL = process.env.AGENTCO_URL || "http://localhost:8080"

type Field = "project" | "model" | "description"
const FIELDS: Field[] = ["project", "model", "description"]

export function TaskCreate() {
  const { state, status, refresh } = useSync()
  const { api } = useSDK()
  const { back, replace } = useRoute()
  const toast = useToast()
  const renderer = useRenderer()

  const [activeField, setActiveField] = createSignal<Field>("project")
  const [projectIndex, setProjectIndex] = createSignal(0)
  const [modelIndex, setModelIndex] = createSignal(0)
  const [models, setModels] = createSignal<string[]>([])
  const [description, setDescription] = createSignal("")
  const [editorUsed, setEditorUsed] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)

  const projects = createMemo(() => state.projects)
  const selectedProject = createMemo(() => projects()[projectIndex()])
  const selectedModel = createMemo(() => models()[modelIndex()])
  const descriptionPreview = createMemo(() => {
    const lines = description().split("\n").filter(l => l.trim())
    if (lines.length <= 1) return description()
    return `${lines[0]} (+${lines.length - 1} more lines)`
  })

  onMount(async () => {
    try {
      const result = await api.listModels()
      if (result.length > 0) {
        setModels(result)
      }
    } catch {
      setModels(["anthropic/claude-opus-4-6"])
    }
  })

  function showMessage(msg: string) {
    setMessage(msg)
    setTimeout(() => setMessage(""), 3000)
  }

  function openEditor() {
    const editor = process.env.EDITOR || process.env.VISUAL || "vi"
    const tmpFile = join(tmpdir(), `agentco-task-${Date.now()}.md`)

    try {
      writeFileSync(tmpFile, description())
      renderer.suspend()

      const result = spawnSync(editor, [tmpFile], { stdio: "inherit" })

      renderer.resume()

      if (result.status === 0) {
        setDescription(readFileSync(tmpFile, "utf-8"))
        setEditorUsed(true)
      } else {
        showMessage("Editor exited with an error")
      }
    } catch (err) {
      renderer.resume()
      showMessage(`Failed to open editor: ${(err as Error).message}`)
    } finally {
      try { unlinkSync(tmpFile) } catch {}
    }
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
    if (!description().trim()) {
      showMessage("Description is required")
      setActiveField("description")
      return
    }

    setSubmitting(true)
    try {
      const model = selectedModel()
      const task = await api.createTask(proj.id, description().trim(), model)
      if (andStart) {
        await api.startTask(task.id)
        toast.show("Task created and started")
        await refresh()
        replace({ name: "task-list" })
      } else {
        toast.show("Task created")
        await refresh()
        replace({ name: "task-detail", taskId: task.id }, [{ name: "task-list" }])
      }
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

    // Model selector
    if (field === "model") {
      if (key.name === "j" || key.name === "down" || key.name === "right") {
        setModelIndex((i) => Math.min(i + 1, models().length - 1))
        return
      }
      if (key.name === "k" || key.name === "up" || key.name === "left") {
        setModelIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (key.name === "return") {
        nextField()
        return
      }
      return
    }

    // Text input field (description)
    if (key.ctrl && key.name === "e") {
      openEditor()
      return
    }
    if (editorUsed()) return
    if (key.name === "backspace") {
      setDescription((v) => v.slice(0, -1))
      return
    }
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      setDescription((v) => v + key.sequence)
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
    const field = activeField()
    if (field === "project" || field === "model") {
      hints.push({ key: "j/k", label: field === "project" ? "select project" : "select model" })
    }
    if (field === "description") {
      hints.push({ key: "ctrl+e", label: "editor" })
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
              <Show when={activeField() === "project" && projects().length > 1}>
                <text fg={colors.textMuted}>{"▲▼"}</text>
              </Show>
              <text fg={activeField() === "project" ? colors.highlightText : colors.text}>
                {selectedProject()?.name || "---"}
              </text>
              <Show when={activeField() === "project" && projects().length > 1}>
                <text fg={colors.textMuted}>
                  ({projectIndex() + 1}/{projects().length})
                </text>
              </Show>
            </box>
          </box>

          {/* Model selector */}
          <box flexDirection="row" width="100%" gap={1}>
            <FieldLabel label="Model" field="model" />
            <box flexDirection="row" gap={1}>
              <Show when={activeField() === "model" && models().length > 1}>
                <text fg={colors.textMuted}>{"▲▼"}</text>
              </Show>
              <text fg={activeField() === "model" ? colors.highlightText : colors.text}>
                {selectedModel() || "loading..."}
              </text>
              <Show when={activeField() === "model" && models().length > 1}>
                <text fg={colors.textMuted}>
                  ({modelIndex() + 1}/{models().length})
                </text>
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
                  <text fg={colors.textMuted}>
                    {activeField() === "description" && !editorUsed() ? "_" : "ctrl+e to open editor"}
                  </text>
                }
              >
                <text fg={activeField() === "description" ? colors.highlightText : colors.text}>
                  {descriptionPreview()}
                </text>
                <Show when={activeField() === "description" && !editorUsed()}>
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
