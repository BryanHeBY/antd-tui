import type { ReactNode } from "react"
import { useToken } from "../theme"
import { darkPalette } from "../color"

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

/** antd 预设色名 → 种子色（渲染时经暗色色板派生，黑底可读） */
const PRESET_COLORS: Record<string, string> = {
  success: "#52c41a",
  processing: "#1677ff",
  error: "#ff4d4f",
  warning: "#faad14",
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
  const seed = color && color !== "default" ? (PRESET_COLORS[color] ?? color) : undefined
  const palette = seed ? darkPalette(seed) : null

  if (bordered) {
    // 前景文字用 hover 档（palette[6]），黑底可读性优先
    return <text fg={palette ? palette[6] : token.colorTextSecondary}>[{children}]</text>
  }
  const fill = palette ? palette[5]! : token.colorBorder
  return (
    <box style={{ backgroundColor: fill, paddingLeft: 1, paddingRight: 1, minHeight: 1 }}>
      <text fg="#ffffff" bg={fill}>
        {children}
      </text>
    </box>
  )
}
