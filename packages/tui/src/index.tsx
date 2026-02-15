import { render, useRenderer } from "@opentui/solid"
import { Switch, Match } from "solid-js"
import { SDKProvider } from "./providers/sdk.js"
import { SyncProvider } from "./providers/sync.js"
import { RouteProvider, useRoute } from "./providers/route.js"
import { ToastProvider, useToast } from "./providers/toast.js"
import { TaskList } from "./views/TaskList.js"
import { TaskDetail } from "./views/TaskDetail.js"
import { TaskCreate } from "./views/TaskCreate.js"
import { copyToClipboard } from "./lib/clipboard.js"

const AGENTCO_URL = process.env.AGENTCO_URL || "http://localhost:8080"

function Router() {
  const { view } = useRoute()

  return (
    <Switch>
      <Match when={view().name === "task-list"}>
        <TaskList />
      </Match>
      <Match when={view().name === "task-detail"}>
        <TaskDetail taskId={(view() as { taskId: string }).taskId} />
      </Match>
      <Match when={view().name === "task-create"}>
        <TaskCreate />
      </Match>
    </Switch>
  )
}

function Shell() {
  const renderer = useRenderer()
  const toast = useToast()

  const handleMouseUp = () => {
    const selection = renderer.getSelection()
    if (!selection) return
    const text = selection.getSelectedText()
    if (!text) return
    copyToClipboard(text)
    toast.show("Copied to clipboard")
    renderer.clearSelection()
  }

  return (
    <box width="100%" height="100%" onMouseUp={handleMouseUp}>
      <Router />
    </box>
  )
}

const App = () => {
  return (
    <SDKProvider baseUrl={AGENTCO_URL}>
      <SyncProvider>
        <RouteProvider>
          <ToastProvider>
            <Shell />
          </ToastProvider>
        </RouteProvider>
      </SyncProvider>
    </SDKProvider>
  )
}

render(App)
