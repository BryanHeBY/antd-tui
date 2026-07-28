import type { ReactNode } from "react"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * antd Grid 的 TUI 版：字段与语义对齐 antd（Row gutter / Col span·flex），
 * 自适应由 schema 用标准语义表达（Col flex: 1 均分、Row style flex: 1 占满高度）。
 */

export interface RowProps {
  /** 列间距（终端字符列数）；数组形式取水平分量（不支持 wrap 的垂直分量） */
  gutter?: number | [number, number]
  style?: CssLikeStyle
  children?: ReactNode
}

export function Row({ gutter = 0, style, children }: RowProps) {
  const gap = Array.isArray(gutter) ? gutter[0] : gutter
  return (
    <box style={{ flexDirection: "row", width: "100%", gap, ...toBoxStyle(style) }}>{children}</box>
  )
}

export interface ColProps {
  /** 占 24 栅格中的几格（定宽百分比） */
  span?: number
  /** CSS flex：数字 n 按比例均分剩余宽度（antd Col flex 语义） */
  flex?: number
  style?: CssLikeStyle
  children?: ReactNode
}

export function Col({ span, flex, style, children }: ColProps) {
  const base: Record<string, unknown> =
    flex !== undefined
      ? { flexGrow: flex, flexShrink: 1, flexBasis: 0 }
      : span !== undefined
        ? { width: `${(Math.min(Math.max(span, 0), 24) / 24) * 100}%` }
        : {}
  return <box style={{ flexDirection: "column", ...base, ...toBoxStyle(style) }}>{children}</box>
}
