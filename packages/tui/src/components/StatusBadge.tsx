import { statusColor, statusLabel } from "../lib/theme.js";

export function StatusBadge(props: { status: string }) {
  return <text fg={statusColor(props.status)}>{statusLabel(props.status)}</text>;
}
