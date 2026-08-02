import { TextAttributes } from "@opentui/core"
import { useMemo, type ReactNode } from "react"
import { useToken } from "../theme"
import { toBoxStyle, type CssLikeStyle } from "../style"
import { displayWidth, truncateToWidth } from "../width"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 *
 * 终端表格：等宽字符栅格。列宽优先取 column.width，其余列按内容宽度自适应；
 * 单元格内容超宽时截断并以 … 结尾（终端无换行省略号能力）。
 */

export interface TableColumn<T = Record<string, unknown>> {
  /** 同 antd：列标题 */
  title: string
  /** 同 antd：取值字段名 */
  dataIndex?: string
  /** 同 antd：列 key（缺省时用 dataIndex） */
  key?: string
  /** 同 antd：列宽（字符数）；缺省按内容自适应 */
  width?: number
  /** 同 antd：对齐方式 */
  align?: "left" | "center" | "right"
  /** 类似 antd render 但不提供 index 之外的额外参数：返回字符串而非 ReactNode */
  tuiRender?: (value: unknown, record: T, index: number) => string
}

export interface TableProps<T = Record<string, unknown>> {
  /** 同 antd：列定义 */
  columns?: Array<TableColumn<T>>
  /** 同 antd：数据源 */
  dataSource?: T[]
  /** 同 antd：行 key 字段名（缺省用数组下标） */
  rowKey?: string
  /** 同 antd：显示边框（终端为分隔线） */
  bordered?: boolean
  /** 类似 antd locale.emptyText：无数据时的占位文案 */
  tuiEmptyText?: string
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
}

/** 终端等宽单元格：按显示宽度（CJK 占 2 列）截断或补空格 */
function fit(text: string, width: number, align: TableColumn["align"] = "left"): string {
  const w = displayWidth(text)
  if (w > width) return truncateToWidth(text, width)
  const pad = width - w
  if (align === "right") return " ".repeat(pad) + text
  if (align === "center") {
    const left = Math.floor(pad / 2)
    return " ".repeat(left) + text + " ".repeat(pad - left)
  }
  return text + " ".repeat(pad)
}

export function Table<T extends Record<string, unknown>>({
  columns = [],
  dataSource = [],
  rowKey,
  bordered = false,
  style,
  tuiEmptyText = "暂无数据",
}: TableProps<T>) {
  const token = useToken()

  const cells = useMemo(
    () =>
      dataSource.map((record, index) =>
        columns.map((column) => {
          const raw = column.dataIndex ? record[column.dataIndex] : undefined
          if (column.tuiRender) return column.tuiRender(raw, record, index)
          return raw === undefined || raw === null ? "" : String(raw)
        }),
      ),
    [columns, dataSource],
  )

  const widths = useMemo(
    () =>
      columns.map((column, columnIndex) => {
        if (column.width !== undefined) return Math.max(1, column.width)
        const contentWidth = cells.reduce(
          (max, row) => Math.max(max, displayWidth(row[columnIndex] ?? "")),
          displayWidth(column.title),
        )
        return Math.max(1, contentWidth)
      }),
    [columns, cells],
  )

  const gap = bordered ? " │ " : "  "
  const header = columns.map((c, i) => fit(c.title, widths[i]!, c.align)).join(gap)
  const rule = widths.map((w) => "─".repeat(w)).join(bordered ? "─┼─" : "  ")

  return (
    <box style={{ flexDirection: "column", ...toBoxStyle(style) }}>
      <text attributes={TextAttributes.BOLD} fg={token.colorText}>
        <b>{header}</b>
      </text>
      <text attributes={0} fg={token.colorBorder}>{rule}</text>
      {cells.length === 0 ? (
        <text attributes={0} fg={token.colorTextSecondary}>{tuiEmptyText}</text>
      ) : (
        cells.map((row, rowIndex) => (
          <text attributes={0}
            key={rowKey ? String(dataSource[rowIndex]![rowKey]) : rowIndex}
            fg={token.colorText}
          >
            {row.map((cell, columnIndex) => fit(cell, widths[columnIndex]!, columns[columnIndex]!.align)).join(gap)}
          </text>
        ))
      )}
    </box>
  )
}
