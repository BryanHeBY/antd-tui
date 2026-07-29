import type { ReactNode } from "react"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * antd Grid 的 TUI 版：字段与语义对齐 antd（Row gutter / Col span·flex），
 * 自适应由 schema 用标准语义表达（Col flex: 1 均分、Row style flex: 1 占满高度）。
 */

export interface RowProps {
  /** 同 antd：列间距；数组依次为水平 / 垂直间距（终端字符行列数） */
  gutter?: number | [number, number]
  /** 同 antd：交叉轴对齐 */
  align?: "top" | "middle" | "bottom" | "stretch"
  /** 同 antd：主轴分布 */
  justify?: "start" | "end" | "center" | "space-around" | "space-between" | "space-evenly"
  /** 同 antd：子项超出一行时换行（默认换行） */
  wrap?: boolean
  style?: CssLikeStyle
  children?: ReactNode
}

export function Row({ gutter = 0, align, justify, wrap = true, style, children }: RowProps) {
  const [columnGap, rowGap] = Array.isArray(gutter) ? gutter : [gutter, 0]
  const alignItems =
    align === "top" ? "flex-start" : align === "middle" ? "center" : align === "bottom" ? "flex-end" : align
  const justifyContent =
    justify === "start" ? "flex-start" : justify === "end" ? "flex-end" : justify
  return (
    <box
      style={{
        flexDirection: "row",
        width: "100%",
        flexWrap: wrap ? "wrap" : "no-wrap",
        columnGap,
        rowGap,
        ...(alignItems ? { alignItems } : {}),
        ...(justifyContent ? { justifyContent } : {}),
        ...toBoxStyle(style),
      }}
    >
      {children}
    </box>
  )
}

export interface ColProps {
  /** 占 24 栅格中的几格（定宽百分比） */
  span?: number
  /** 同 antd：左侧留出的 24 栅格数 */
  offset?: number
  /** 同 antd：CSS flex；数字按比例分配，auto / none 分别沿用 CSS 语义 */
  flex?: number | "auto" | "none"
  style?: CssLikeStyle
  children?: ReactNode
}

export function Col({ span, offset, flex, style, children }: ColProps) {
  const base: Record<string, unknown> =
    typeof flex === "number"
      ? { flexGrow: flex, flexShrink: 1, flexBasis: 0 }
      : flex === "auto"
        ? { flexGrow: 1, flexShrink: 1, flexBasis: "auto" }
        : flex === "none"
          ? { flexGrow: 0, flexShrink: 0, flexBasis: "auto" }
      : span !== undefined
        ? { width: `${(Math.min(Math.max(span, 0), 24) / 24) * 100}%` }
        : {}
  const offsetPercent: `${number}%` | undefined =
    offset === undefined ? undefined : `${(Math.min(Math.max(offset, 0), 24) / 24) * 100}%`
  return (
    <box
      style={{
        flexDirection: "column",
        ...base,
        ...(offsetPercent ? { marginLeft: offsetPercent } : {}),
        ...toBoxStyle(style),
      }}
    >
      {children}
    </box>
  )
}
