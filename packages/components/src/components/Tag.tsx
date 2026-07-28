import type { ReactNode } from "react"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：bordered 为方括号包裹 [文本]，否则为背景色块。
 */
export interface TagProps {
  /** 同 antd：预设色名或十六进制色值 */
  color?: string
  /** 同 antd：是否带边框（终端用方括号表示） */
  bordered?: boolean
  children?: ReactNode
}

/** antd 预设色名 → 终端色值 */
const PRESET_COLORS: Record<string, string> = {
  success: "#52c41a",
  processing: "#1677ff",
  error: "#ff4d4f",
  warning: "#faad14",
  default: "#8c8c8c",
  magenta: "#eb2f96",
  red: "#f5222d",
  volcano: "#fa541c",
  orange: "#fa8c16",
  gold: "#faad14",
  lime: "#a0d911",
  green: "#52c41a",
  cyan: "#13c2c2",
  blue: "#1677ff",
  geekblue: "#2f54eb",
  purple: "#722ed1",
}

export function Tag({ color, bordered = true, children }: TagProps) {
  const token = useToken()
  const resolved = color ? (PRESET_COLORS[color] ?? color) : token.colorBorder

  if (bordered) {
    return (
      <text fg={resolved}>
        [{children}]
      </text>
    )
  }
  return (
    <box style={{ backgroundColor: resolved, paddingLeft: 1, paddingRight: 1, minHeight: 1 }}>
      <text fg="#ffffff" bg={resolved}>
        {children}
      </text>
    </box>
  )
}
