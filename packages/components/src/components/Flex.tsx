import type { ReactNode } from "react"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * antd Flex 的 TUI 子集。
 *
 * vertical / gap / justify / align / wrap / flex 都沿用 antd 命名。
 * tuiScroll 是终端扩展：把 Flex 的内容区变为纵向可滚动视口；Web antd 的
 * 滚动通常由 CSS overflow 表达，终端需要明确选择 ScrollBox 渲染器。
 */
export interface FlexProps {
  vertical?: boolean
  gap?: number
  justify?: "flex-start" | "flex-end" | "center" | "space-between" | "space-around" | "space-evenly"
  align?: "flex-start" | "flex-end" | "center" | "stretch" | "baseline"
  wrap?: boolean | "nowrap" | "wrap" | "wrap-reverse"
  flex?: number
  style?: CssLikeStyle
  /** TUI 扩展：以纵向 ScrollBox 承载内容，滚轮/方向键可滚动。 */
  tuiScroll?: boolean
  children?: ReactNode
}

export function Flex({
  vertical = false,
  gap = 0,
  justify,
  align,
  wrap,
  flex,
  style,
  tuiScroll = false,
  children,
}: FlexProps) {
  const layout: Record<string, unknown> = {
    flexDirection: vertical ? "column" : "row",
    gap,
    ...(justify ? { justifyContent: justify } : {}),
    ...(align ? { alignItems: align } : {}),
    ...(wrap !== undefined
      ? { flexWrap: wrap === true ? "wrap" : wrap === false ? "nowrap" : wrap }
      : {}),
    ...(flex !== undefined ? { flexGrow: flex, flexShrink: 1, flexBasis: 0 } : {}),
    ...toBoxStyle(style),
  }

  if (tuiScroll) {
    return (
      <scrollbox
        style={layout}
        scrollY
        scrollX={false}
        contentOptions={{ flexDirection: vertical ? "column" : "row", gap, minHeight: "100%" }}
      >
        {children}
      </scrollbox>
    )
  }

  return <box style={layout}>{children}</box>
}
