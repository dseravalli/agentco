import { render } from "@opentui/solid"
import { Switch, Match } from "solid-js"
import { SDKProvider } from "./providers/sdk.js"
import { SyncProvider } from "./providers/sync.js"
import { RouteProvider, useRoute } from "./providers/route.js"
import { ToastProvider } from "./providers/toast.js"
import { TaskList } from "./views/TaskList.js"
import { TaskDetail } from "./views/TaskDetail.js"
import { TaskCreate } from "./views/TaskCreate.js"

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

const App = () => {
  return (
    <SDKProvider baseUrl={AGENTCO_URL}>
      <SyncProvider>
        <RouteProvider>
          <ToastProvider>
            <Router />
          </ToastProvider>
        </RouteProvider>
      </SyncProvider>
    </SDKProvider>
  )
}

render(App)
