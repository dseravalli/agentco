import { Show, type Accessor } from "solid-js"
import type { SyncStatus } from "../providers/sync.js"
import { useToast } from "../providers/toast.js"
import { colors } from "../lib/theme.js"

export function Header(props: { status: Accessor<SyncStatus>; baseUrl: string }) {
  const { message } = useToast()

  const statusText = () => {
    const s = props.status()
    if (s === "connected") return props.baseUrl
    if (s === "loading") return "connecting..."
    return "disconnected - retrying..."
  }

  const statusFg = () => {
    const s = props.status()
    if (s === "connected") return colors.textMuted
    if (s === "loading") return colors.warning
    return colors.error
  }

  return (
    <box
      width="100%"
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingX={1}
    >
      <box flexDirection="row" gap={2}>
        <text>
          <span fg={colors.accent}><b>AgentCo</b></span>
        </text>
        <Show when={message()}>
          <text fg={colors.warning}>{message()}</text>
        </Show>
      </box>
      <text fg={statusFg()}>{statusText()}</text>
    </box>
  )
}
