import { TextAttributes } from "@opentui/core"
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
  /** 同 antd：标题行右侧的补充内容（字符串或组件） */
  extra?: ReactNode
  /** 同 antd：是否带外框；false 时保留内边距形成无框分区 */
  bordered?: boolean
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  children?: ReactNode
}

export function Card({ title, extra, bordered = true, style, children }: CardProps) {
  const token = useToken()
  const extraRow =
    extra !== undefined && extra !== null ? (
      <box style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        {typeof extra === "string" || typeof extra === "number" ? (
          <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>{String(extra)}</text>
        ) : (
          extra
        )}
      </box>
    ) : null
  return (
    <box
      border={bordered}
      title={bordered ? title : undefined}
      style={{
        ...(bordered
          ? { borderStyle: token.borderStyle, borderColor: token.colorBorder }
          : {}),
        padding: token.padding,
        flexDirection: "column",
        ...toBoxStyle(style),
      }}
    >
      {!bordered && title ? (
        <text attributes={TextAttributes.BOLD} fg={token.colorText}>
          <b>{title}</b>
        </text>
      ) : null}
      {extraRow}
      {children}
    </box>
  )
}
