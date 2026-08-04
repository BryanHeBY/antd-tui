import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useFocusable, useToken } from "@antd-tui/components"

export function TopMenuAction({
  hotkey,
  children,
  danger = false,
  disabled = false,
  onActivate,
}: {
  hotkey?: string
  children: string
  danger?: boolean
  disabled?: boolean
  onActivate: () => void
}) {
  const token = useToken()
  const { focused, getFocusedKind, isActiveScope, requestFocus } = useFocusable({
    kind: "action",
    disabled,
    onActivate,
  })

  useKeyboard((key) => {
    if (!hotkey || disabled || !isActiveScope() || getFocusedKind() === "input") return
    if (key.sequence === hotkey) onActivate()
  })

  const foreground = disabled
    ? token.colorTextDisabled
    : danger
      ? token.colorError
      : focused
        ? token.colorPrimaryHover
        : token.colorText
  const backgroundColor = focused ? "#303030" : "transparent"
  return (
    <box
      style={{ height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1, backgroundColor }}
      onMouseDown={() => {
        if (disabled) return
        requestFocus()
        onActivate()
      }}
    >
      <text attributes={focused ? TextAttributes.BOLD : 0} fg={foreground} bg={backgroundColor}>{children}</text>
    </box>
  )
}
