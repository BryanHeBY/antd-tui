import type { ReactNode } from "react"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 */

type TextType = "secondary" | "success" | "warning" | "danger"

export interface TextProps {
  /** 同 antd：语义色 */
  type?: TextType
  /** 同 antd：加粗 */
  strong?: boolean
  /** TUI 扩展：在父容器交叉轴上的对齐（antd Typography 无此能力） */
  tuiAlign?: "left" | "center" | "right"
  children?: ReactNode
}

function useTypeColor(type?: TextType): string {
  const token = useToken()
  switch (type) {
    case "secondary":
      return token.colorTextSecondary
    case "success":
      return token.colorSuccess
    case "warning":
      return token.colorWarning
    case "danger":
      return token.colorError
    default:
      return token.colorText
  }
}

function Text({ type, strong, tuiAlign, children }: TextProps) {
  const color = useTypeColor(type)
  const alignSelf =
    tuiAlign === "right"
      ? ("flex-end" as const)
      : tuiAlign === "center"
        ? ("center" as const)
        : undefined
  return (
    <text fg={color} style={alignSelf ? { alignSelf } : undefined}>
      {strong ? <b>{children}</b> : children}
    </text>
  )
}

export interface TitleProps {
  children?: ReactNode
}

function Title({ children }: TitleProps) {
  const token = useToken()
  return (
    <text fg={token.colorPrimaryHover}>
      <b>{children}</b>
    </text>
  )
}

export const Typography = { Text, Title }
