import type { ToolCall, ToolCallUpdate } from "@antd-tui/acp"

/** 工具卡片最多显示的行数：diff 或长输出不该把整屏挤满。 */
const MAX_TOOL_LINES = 12

interface ToolContentBlock {
  type?: string
  content?: { type?: string; text?: string }
  path?: string
  oldText?: string | null
  newText?: string
  terminalId?: string
}

/**
 * 把 ACP 的 ToolCallContent 压成几行摘要。
 *
 * content/diff/terminal 三种变体：文本直接取行，diff 只给路径与增删行数（真正的
 * diff 视图留给后续），terminal 记下 id——终端能力尚未声明，只是留痕。
 */
export function toolLines(content: ToolCall["content"] | ToolCallUpdate["content"]): string[] {
  if (!content) return []
  const lines: string[] = []
  for (const raw of content as ToolContentBlock[]) {
    if (raw.type === "diff") {
      const added = (raw.newText ?? "").split("\n").length
      const removed = (raw.oldText ?? "").split("\n").length
      lines.push(`diff ${raw.path ?? "?"}  +${added} -${raw.oldText ? removed : 0}`)
      continue
    }
    if (raw.type === "terminal") {
      lines.push(`terminal ${raw.terminalId ?? "?"}`)
      continue
    }
    const text = raw.content?.type === "text" ? raw.content.text : undefined
    if (text) lines.push(...text.split("\n"))
  }
  if (lines.length <= MAX_TOOL_LINES) return lines
  return [...lines.slice(0, MAX_TOOL_LINES), `… 另有 ${lines.length - MAX_TOOL_LINES} 行`]
}
