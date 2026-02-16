import {
  createContext,
  useContext,
  onMount,
  onCleanup,
  createSignal,
  type JSX,
  type Accessor,
} from "solid-js"
import { createStore, produce } from "solid-js/store"
import type { Project, Task, Alert, WSEvent, AlertType } from "../lib/types.js"
import { useSDK } from "./sdk.js"
import { sendNotification } from "../lib/notify.js"

const NOTIFY_ALERT_TYPES: Set<AlertType> = new Set([
  "needs_permission",
  "needs_question",
  "agent_complete",
  "action_required",
  "error",
])

export type SyncStatus = "loading" | "connected" | "disconnected" | "error"

interface SyncState {
  projects: Project[]
  tasks: Task[]
  alerts: Alert[]
}

interface SyncContextValue {
  state: SyncState
  status: Accessor<SyncStatus>
  refresh: () => Promise<void>
}

const SyncContext = createContext<SyncContextValue>()

export function SyncProvider(props: { children: JSX.Element }) {
  const { api, ws } = useSDK()
  const [status, setStatus] = createSignal<SyncStatus>("loading")
  const [state, setState] = createStore<SyncState>({
    projects: [],
    tasks: [],
    alerts: [],
  })

  async function fetchAll() {
    try {
      const [projects, tasks, alerts] = await Promise.all([
        api.listProjects(),
        api.listTasks(),
        api.listAlerts(),
      ])
      setState({ projects, tasks, alerts })
    } catch {
      setStatus("error")
    }
  }

  function handleWSEvent(event: WSEvent) {
    switch (event.type) {
      case "task:status_changed":
        // Immediately update status for responsiveness
        setState(
          produce((s) => {
            const task = s.tasks.find((t) => t.id === event.taskId)
            if (task) {
              task.status = event.status
              task.updatedAt = new Date().toISOString()
            }
          })
        )
        // Refetch the full task to get updated ports, URLs, etc.
        api.getTask(event.taskId).then((fullTask) => {
          setState(
            produce((s) => {
              const idx = s.tasks.findIndex((t) => t.id === event.taskId)
              if (idx !== -1) {
                s.tasks[idx] = fullTask
              }
            })
          )
        }).catch(() => {
          // Task may have been deleted
        })
        break

      case "task:title_changed":
        setState(
          produce((s) => {
            const task = s.tasks.find((t) => t.id === event.taskId)
            if (task) {
              task.title = event.title
              task.updatedAt = new Date().toISOString()
            }
          })
        )
        break

      case "task:alert":
        setState(
          produce((s) => {
            const exists = s.alerts.some((a) => a.id === event.alert.id)
            if (!exists) {
              s.alerts.unshift(event.alert)
            }
          })
        )
        if (NOTIFY_ALERT_TYPES.has(event.alert.type)) {
          const task = state.tasks.find((t) => t.id === event.taskId)
          const title = task ? `AgentCo - ${task.title}` : "AgentCo"
          sendNotification(title, event.alert.message)
        }
        break
    }
  }

  const removeEventListener = ws.onEvent(handleWSEvent)

  const removeStatusListener = ws.onStatus((connected) => {
    setStatus(connected ? "connected" : "disconnected")
    if (connected) fetchAll()
  })

  onMount(() => {
    fetchAll().then(() => {
      if (status() === "loading") setStatus("connected")
    })
  })

  onCleanup(() => {
    removeEventListener()
    removeStatusListener()
  })

  async function refresh() {
    await fetchAll()
  }

  return (
    <SyncContext.Provider value={{ state, status, refresh }}>
      {props.children}
    </SyncContext.Provider>
  )
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error("useSync must be used within SyncProvider")
  return ctx
}
