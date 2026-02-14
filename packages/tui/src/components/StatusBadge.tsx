import { statusColor } from "../lib/theme.js"

export function StatusBadge(props: { status: string }) {
  return (
    <text fg={statusColor(props.status)}>
      {props.status}
    </text>
  )
}
