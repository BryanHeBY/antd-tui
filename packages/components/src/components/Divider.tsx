import { TextAttributes } from "@opentui/core"
import { isValidElement, type ReactNode } from "react"
import { useToken } from "../theme"
import { useMeasuredWidth } from "../measure"
import { displayWidth } from "../width"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：横向分割线，可嵌文字（orientation 控制文字位置）。
 */
export interface DividerProps {
  /** 同 antd：虚线 */
  dashed?: boolean
  /** 同 antd：文字位置 */
  orientation?: "left" | "center" | "right"
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  /** 同 antd：分割线文字 */
  children?: ReactNode
}

const FULL_WIDTH_FALLBACK = 40

/** 分割线文字需要拍平成纯文本排版；x-content 等通道会把文字包进 Fragment，这里递归提取 */
function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join("")
  if (isValidElement(node)) return nodeToText((node.props as { children?: ReactNode }).children)
  return ""
}

export function Divider({ dashed = false, orientation = "center", style, children }: DividerProps) {
  const token = useToken()
  const { boxRef, width: boxWidth } = useMeasuredWidth()
  const char = dashed ? "╌" : "─"
  const width = boxWidth ?? FULL_WIDTH_FALLBACK
  const text = nodeToText(children)

  if (!text) {
    return (
      <box ref={boxRef} style={{ width: "100%", minHeight: 1, ...toBoxStyle(style) }}>
        <text attributes={TextAttributes.BOLD} fg={token.colorBorder}>{char.repeat(Math.max(1, width))}</text>
      </box>
    )
  }

  const label = ` ${text} `
  const rest = Math.max(0, width - displayWidth(label))
  const [left, right] =
    orientation === "left"
      ? [1, rest - 1]
      : orientation === "right"
        ? [rest - 1, 1]
        : [Math.floor(rest / 2), rest - Math.floor(rest / 2)]

  return (
    <box ref={boxRef} style={{ width: "100%", minHeight: 1, ...toBoxStyle(style) }}>
      <text attributes={TextAttributes.BOLD}>
        <span fg={token.colorBorder}>{char.repeat(Math.max(0, left))}</span>
        <span fg={token.colorText}>{label}</span>
        <span fg={token.colorBorder}>{char.repeat(Math.max(0, right))}</span>
      </text>
    </box>
  )
}
