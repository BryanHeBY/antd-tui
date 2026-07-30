import type { ReactNode } from "react"
import { useToken } from "../theme"
import { toBoxStyle, type CssLikeStyle } from "../style"

export interface SpaceProps {
  direction?: "horizontal" | "vertical"
  size?: number
  /** 与 antd Space 一致：空间不足时让子项换行。 */
  wrap?: boolean
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  children?: ReactNode
}

export function Space({ direction = "horizontal", size = 1, wrap = false, style, children }: SpaceProps) {
  return (
    <box
      style={{
        flexDirection: direction === "horizontal" ? "row" : "column",
        gap: size,
        ...(wrap ? { flexWrap: "wrap" } : {}),
        ...toBoxStyle(style),
      }}
    >
      {children}
    </box>
  )
}

export interface CardProps {
  title?: string
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  children?: ReactNode
}

export function Card({ title, style, children }: CardProps) {
  const token = useToken()
  return (
    <box
      border
      title={title}
      style={{
        borderStyle: token.borderStyle,
        borderColor: token.colorBorder,
        padding: token.padding,
        flexDirection: "column",
        ...toBoxStyle(style),
      }}
    >
      {children}
    </box>
  )
}
