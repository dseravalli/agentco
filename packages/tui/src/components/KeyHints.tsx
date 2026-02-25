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
          <text>
            <span fg={colors.key}>{hint.key}</span>
            <span fg={colors.keyLabel}> {hint.label}</span>
          </text>
        )}
      </For>
    </box>
  );
}
