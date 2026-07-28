import { TextAttributes } from "@opentui/core"
import { useRef, type ReactNode } from "react"
import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 */
export interface ButtonProps {
  /** 同 antd（子集）：按钮类型 */
  type?: "primary" | "default"
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 同 antd：宽度撑满父容器 */
  block?: boolean
  /** 类似 antd size 但形态不同：small 为无边框填充色块（终端里紧凑形态无法保留边框） */
  tuiSize?: "middle" | "small"
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  /**
   * TUI 扩展：全局热键（输入类组件聚焦时失效）。
   * 命名空间规则：单字符（如 "7" "+" "%"）只匹配可见字符 key.sequence；
   * 多字符（如 "backspace" "f1"）只匹配命名键 key.name。
   */
  tuiHotkey?: string
  /** 同 antd：点击/激活回调（终端无 DOM 事件，不提供 event 参数） */
  onClick?: () => void
  children?: ReactNode
}

export function Button({
  type = "default",
  disabled = false,
  block = false,
  tuiSize = "middle",
  style,
  tuiHotkey,
  onClick,
  children,
}: ButtonProps) {
  const token = useToken()
  const boxRef = useRef<BoxRenderable | null>(null)
  const { focused, getFocusedKind, isActiveScope, requestFocus } = useFocusable({
    kind: "action",
    disabled,
    onActivate: onClick,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })

  // 浏览器直觉：点击按钮同时把焦点转移过去
  const handleMouseDown = () => {
    if (disabled) return
    requestFocus()
    onClick?.()
  }

  useKeyboard((key) => {
    if (!tuiHotkey || disabled || !isActiveScope()) return
    // 输入框/选择器聚焦时按键归它们，热键静默
    if (getFocusedKind() === "input") return
    // 单字符走可见字符（sequence），多字符走命名键（name），两套命名空间不混用
    const hit = tuiHotkey.length === 1 ? key.sequence === tuiHotkey : key.name === tuiHotkey
    if (hit) onClick?.()
  })

  const isPrimary = type === "primary"

  if (tuiSize === "small") {
    // 紧凑形态：无边框填充色块，聚焦时反色
    const backgroundColor = disabled
      ? "#262626"
      : focused
        ? "#e6e6e6"
        : isPrimary
          ? token.colorPrimary
          : "#373737"
    const textColor = disabled ? token.colorTextDisabled : focused ? "#141414" : "#ffffff"
    return (
      <box
        ref={boxRef}
        style={{
          backgroundColor,
          minHeight: 1,
          alignItems: "center",
          justifyContent: "center",
          ...(block ? { width: "100%" } : { paddingLeft: 1, paddingRight: 1 }),
          ...toBoxStyle(style),
        }}
        onMouseDown={handleMouseDown}
      >
        <text attributes={TextAttributes.BOLD} fg={textColor} bg={backgroundColor}>
          {focused ? <b>{children}</b> : children}
        </text>
      </box>
    )
  }

  const borderColor = disabled
    ? token.colorTextDisabled
    : focused
      ? token.colorPrimaryHover
      : isPrimary
        ? token.colorPrimary
        : token.colorBorder
  // primary 的填充色只涂在边框内的内容行：涂满整个盒子会把圆角边框淹没成直角实心块
  const fillColor = isPrimary && !disabled ? token.colorPrimary : "transparent"
  const textColor = disabled
    ? token.colorTextDisabled
    : isPrimary
      ? "#ffffff"
      : focused
        ? token.colorPrimaryHover
        : token.colorText

  return (
    <box
      ref={boxRef}
      border
      style={{
        borderStyle: focused ? "double" : token.borderStyle,
        borderColor,
        height: 3,
        ...(block ? { width: "100%" } : null),
        ...toBoxStyle(style),
      }}
      onMouseDown={handleMouseDown}
    >
      <box
        style={{
          flexGrow: 1,
          backgroundColor: fillColor,
          alignItems: "center",
          justifyContent: "center",
          paddingLeft: block ? 0 : 2,
          paddingRight: block ? 0 : 2,
        }}
      >
        <text attributes={TextAttributes.BOLD} fg={textColor} bg={isPrimary && !disabled ? fillColor : undefined}>
          {focused ? <b>{children}</b> : children}
        </text>
      </box>
    </box>
  )
}
