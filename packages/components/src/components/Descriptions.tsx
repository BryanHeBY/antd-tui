import { TextAttributes } from "@opentui/core"
import type { ReactNode } from "react"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：每行 column 组「标签: 值」，标签为次要色。
 */
export interface DescriptionsItem {
  /** 同 antd：列表项键（React key） */
  key?: string
  /** 同 antd：标签 */
  label: ReactNode
  /** 同 antd：内容 */
  children: ReactNode
}

export interface DescriptionsProps {
  /** 同 antd：标题 */
  title?: ReactNode
  /** 同 antd：描述项（对齐 antd v5 的 items 用法） */
  items?: DescriptionsItem[]
  /** 同 antd：一行显示几项 */
  column?: number
  /** 同 antd：带边框（终端渲染为 Card 式外框） */
  bordered?: boolean
}

function chunk<T>(list: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < list.length; i += size) rows.push(list.slice(i, i + size))
  return rows
}

export function Descriptions({
  title,
  items = [],
  column = 1,
  bordered = false,
}: DescriptionsProps) {
  const token = useToken()
  const rows = chunk(items, Math.max(1, column))

  const content = (
    <box style={{ flexDirection: "column" }}>
      {title ? <text attributes={TextAttributes.BOLD} fg={token.colorText}>{<b>{title}</b>}</text> : null}
      {rows.map((row, rowIndex) => (
        <box key={rowIndex} style={{ flexDirection: "row", gap: 2 }}>
          {row.map((item, colIndex) => (
            <box
              key={item.key ?? `${rowIndex}-${colIndex}`}
              style={{ flexDirection: "row", flexGrow: 1, flexBasis: 0 }}
            >
              <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>{item.label}: </text>
              <text attributes={TextAttributes.BOLD} fg={token.colorText}>{item.children}</text>
            </box>
          ))}
        </box>
      ))}
    </box>
  )

  if (!bordered) return content
  return (
    <box
      border
      style={{
        borderStyle: token.borderStyle,
        borderColor: token.colorBorder,
        padding: token.paddingXS,
        flexDirection: "column",
      }}
    >
      {content}
    </box>
  )
}
