import { useRef, type ReactNode } from "react"
import type { BoxRenderable } from "@opentui/core"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：横向分割线，可嵌文字（orientation 控制文字位置）。
 */
export interface DividerProps {
  /** 同 antd：虚线 */
  dashed?: boolean
  /** 同 antd：文字位置 */
  orientation?: "left" | "center" | "right"
  /** 同 antd：分割线文字 */
  children?: ReactNode
}

const FULL_WIDTH_FALLBACK = 40

export function Divider({ dashed = false, orientation = "center", children }: DividerProps) {
  const token = useToken()
  const boxRef = useRef<BoxRenderable | null>(null)
  const char = dashed ? "╌" : "─"
  const width = boxRef.current?.width ?? FULL_WIDTH_FALLBACK

  if (!children) {
    return (
      <box ref={boxRef} style={{ width: "100%", minHeight: 1 }}>
        <text fg={token.colorBorder}>{char.repeat(Math.max(1, width))}</text>
      </box>
    )
  }

  const label = ` ${String(children)} `
  const rest = Math.max(0, width - label.length)
  const [left, right] =
    orientation === "left"
      ? [1, rest - 1]
      : orientation === "right"
        ? [rest - 1, 1]
        : [Math.floor(rest / 2), rest - Math.floor(rest / 2)]

  return (
    <box ref={boxRef} style={{ width: "100%", minHeight: 1 }}>
      <text>
        <span fg={token.colorBorder}>{char.repeat(Math.max(0, left))}</span>
        <span fg={token.colorText}>{label}</span>
        <span fg={token.colorBorder}>{char.repeat(Math.max(0, right))}</span>
      </text>
    </box>
  )
}
