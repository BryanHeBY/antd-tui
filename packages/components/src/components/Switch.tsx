import { TextAttributes } from "@opentui/core"
import { useRef, type ReactNode } from "react"
import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：[ 开 ●] / [● 关 ]。聚焦后 Enter 或 Space 切换。
 */
export interface SwitchProps {
  /** 同 antd：受控选中态 */
  checked?: boolean
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 同 antd：加载中（loading 时不可切换） */
  loading?: boolean
  /** 同 antd：选中时的内容 */
  checkedChildren?: ReactNode
  /** 同 antd：未选中时的内容 */
  unCheckedChildren?: ReactNode
  /** 类似 antd onChange，但终端无 DOM 事件参数 */
  tuiOnChange?: (checked: boolean) => void
}

export function Switch({
  checked = false,
  disabled = false,
  loading = false,
  checkedChildren,
  unCheckedChildren,
  tuiOnChange,
}: SwitchProps) {
  const token = useToken()
  const boxRef = useRef<BoxRenderable | null>(null)
  const locked = disabled || loading
  const toggle = () => {
    if (!locked) tuiOnChange?.(!checked)
  }
  const { focused, isActiveScope, requestFocus } = useFocusable({
    kind: "action",
    disabled: locked,
    onActivate: toggle,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })

  useKeyboard((key) => {
    if (focused && isActiveScope() && key.name === "space") toggle()
  })

  // 聚焦用反色高亮而非边框：设置 borderColor 会让盒子长出边框，高度 1→3 行导致布局跳变
  const backgroundColor = locked
    ? "#262626"
    : focused
      ? "#e6e6e6"
      : checked
        ? token.colorPrimary
        : "#373737"
  const textColor = locked ? token.colorTextDisabled : focused ? "#141414" : "#ffffff"
  const label = checked ? checkedChildren : unCheckedChildren
  const knob = loading ? "◌" : "●"

  return (
    <box
      ref={boxRef}
      style={{
        backgroundColor,
        minHeight: 1,
        paddingLeft: 1,
        paddingRight: 1,
        flexDirection: "row",
        alignSelf: "flex-start",
      }}
      onMouseDown={() => {
        // 浏览器直觉：点击控件同时把焦点转移过去
        requestFocus()
        toggle()
      }}
    >
      <text attributes={TextAttributes.BOLD} fg={textColor} bg={backgroundColor}>
        {checked ? (
          <>
            {label ? <span>{String(label)} </span> : null}
            {knob}
          </>
        ) : (
          <>
            {knob}
            {label ? <span> {String(label)}</span> : null}
          </>
        )}
      </text>
    </box>
  )
}
