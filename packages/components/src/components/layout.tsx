import type { ReactNode } from "react"
import { useToken } from "../theme"

export interface SpaceProps {
  direction?: "horizontal" | "vertical"
  size?: number
  /** 与 antd Space 一致：空间不足时让子项换行。 */
  wrap?: boolean
  children?: ReactNode
}

export function Space({ direction = "horizontal", size = 1, wrap = false, children }: SpaceProps) {
  return (
    <box
      style={{
        flexDirection: direction === "horizontal" ? "row" : "column",
        gap: size,
        ...(wrap ? { flexWrap: "wrap" } : {}),
      }}
    >
      {children}
    </box>
  )
}

export interface CardProps {
  title?: string
  children?: ReactNode
}

export function Card({ title, children }: CardProps) {
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
      }}
    >
      {children}
    </box>
  )
}
