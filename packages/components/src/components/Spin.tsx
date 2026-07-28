import { TextAttributes } from "@opentui/core"
import { useEffect, useState, type ReactNode } from "react"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：Braille 点阵旋转帧 + 可选提示文字。
 */
export interface SpinProps {
  /** 同 antd：是否旋转（false 时直接渲染子节点） */
  spinning?: boolean
  /** 同 antd：提示文字 */
  tip?: ReactNode
  /** TUI 扩展：帧间隔毫秒（antd 无此字段，终端动画节流用） */
  tuiIntervalMs?: number
  children?: ReactNode
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function Spin({ spinning = true, tip, tuiIntervalMs = 80, children }: SpinProps) {
  const token = useToken()
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (!spinning) return
    const timer = setInterval(() => setFrame((f) => (f + 1) % FRAMES.length), tuiIntervalMs)
    return () => clearInterval(timer)
  }, [spinning, tuiIntervalMs])

  if (!spinning) return <>{children}</>

  return (
    <box style={{ flexDirection: "row", minHeight: 1 }}>
      <text attributes={TextAttributes.BOLD} fg={token.colorPrimaryHover}>{FRAMES[frame]}</text>
      {tip ? <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}> {tip}</text> : null}
    </box>
  )
}
