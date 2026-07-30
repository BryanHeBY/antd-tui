import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import { useToken } from "../theme"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：左边框着色的提示块，图标用 ASCII 字符替代。
 */
export interface AlertProps {
  /** 同 antd：提示类型 */
  type?: "success" | "info" | "warning" | "error"
  /** 同 antd：提示标题 */
  message?: ReactNode
  /** 同 antd：辅助描述 */
  description?: ReactNode
  /** 同 antd：显示图标（终端用 ✓ i ! ✗ 字符） */
  showIcon?: boolean
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  children?: ReactNode
}

const ICONS: Record<string, string> = {
  success: "✓",
  info: "i",
  warning: "!",
  error: "✗",
}

export function Alert({
  type = "info",
  message,
  description,
  showIcon = false,
  style,
  children,
}: AlertProps) {
  const token = useToken()
  const color =
    type === "success"
      ? token.colorSuccess
      : type === "warning"
        ? token.colorWarning
        : type === "error"
          ? token.colorError
          : token.colorPrimaryHover

  return (
    <box
      border={["left"]}
      style={{
        borderStyle: "heavy",
        borderColor: color,
        paddingLeft: 1,
        flexDirection: "column",
        ...toBoxStyle(style),
      }}
    >
      <text attributes={TextAttributes.BOLD} fg={color}>
        {showIcon ? `${ICONS[type]} ` : ""}
        <b>{message}</b>
      </text>
      {description ? <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>{description}</text> : null}
      {children}
    </box>
  )
}
