import { For } from "solid-js";
import { colors } from "../lib/theme.js";

export interface KeyHint {
  key: string;
  label: string;
}

export function KeyHints(props: { hints: KeyHint[] }) {
  return (
    <box
      width="100%"
      height={1}
      backgroundColor={colors.bg}
      flexDirection="row"
      paddingX={1}
      gap={2}
    >
      <For each={props.hints}>
        {(hint) => (
          <box flexDirection="row">
            <text fg={colors.key}>{hint.key}</text>
            <text fg={colors.keyLabel}> {hint.label}</text>
          </box>
        )}
      </For>
    </box>
  );
}
