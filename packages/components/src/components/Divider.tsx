import { isValidElement, type ReactNode } from "react"
import { useToken } from "../theme"
import { useMeasuredWidth } from "../measure"

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

/** 分割线文字需要拍平成纯文本排版；x-content 等通道会把文字包进 Fragment，这里递归提取 */
function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join("")
  if (isValidElement(node)) return nodeToText((node.props as { children?: ReactNode }).children)
  return ""
}

/** 终端排版宽度：CJK 全角字符占 2 格，JS length 会少算导致分割线溢出换行 */
function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6)
    width += wide ? 2 : 1
  }
  return width
}

export function Divider({ dashed = false, orientation = "center", children }: DividerProps) {
  const token = useToken()
  const { boxRef, width: boxWidth } = useMeasuredWidth()
  const char = dashed ? "╌" : "─"
  const width = boxWidth ?? FULL_WIDTH_FALLBACK
  const text = nodeToText(children)

  if (!text) {
    return (
      <box ref={boxRef} style={{ width: "100%", minHeight: 1 }}>
        <text fg={token.colorBorder}>{char.repeat(Math.max(1, width))}</text>
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
    <box ref={boxRef} style={{ width: "100%", minHeight: 1 }}>
      <text>
        <span fg={token.colorBorder}>{char.repeat(Math.max(0, left))}</span>
        <span fg={token.colorText}>{label}</span>
        <span fg={token.colorBorder}>{char.repeat(Math.max(0, right))}</span>
      </text>
    </box>
  )
}
