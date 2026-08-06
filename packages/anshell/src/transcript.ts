import { useCallback, useRef, useState } from "react"
import type { Block } from "./types"

const BLOCK_LIMIT = 200

export interface TranscriptApi {
  blocks: Block[]
  /** 开一张内嵌 PTY 卡片，返回其 id */
  addTerminal: (
    command: string,
    args: string[],
    cwd: string,
    options?: { label?: string; prompt?: "shell" | "terminal"; fullscreen?: boolean },
  ) => number
  /** 记录一条交给 agent 的用户输入。 */
  addPrompt: (text: string, cwd: string) => void
  /** 按 ACP toolCallId 建/更新工具卡片；content 与 status 都是整体替换 */
  upsertTool: (call: {
    toolCallId: string
    title?: string
    toolKind?: string
    status?: "pending" | "in_progress" | "completed" | "failed"
    lines?: string[]
  }) => void
  /** 开一张待决策的权限卡片，返回其 id */
  addPermission: (
    permission: {
      toolCallId: string
      title: string
      options: Array<{ optionId: string; name: string; kind: string }>
    },
  ) => number
  /** 权限已决策：落定选项名并标记是否来自记忆策略 */
  resolvePermission: (id: number, chosen: string, auto: boolean) => void
  /** 开一张斜杠命令卡片，返回其 id（结果可能异步补齐） */
  addCommand: (name: string, input: string, cwd: string, lines?: string[]) => number
  /** 补齐命令结果 */
  setCommandLines: (id: number, lines: string[]) => void
  /** 内嵌终端结束：标记退出并保留最终画面 */
  closeTerminal: (id: number, exitCode: number) => void
  /** 往当前 agent 卡片聚合流式片段（自动开卡片） */
  appendAgentChunk: (text: string) => void
  /** 结束当前 agent 卡片（下一轮另起） */
  flushAgent: () => void
  /** 追加一条纯行提示 */
  addNote: (level: "system" | "error", text: string) => void
  clear: () => void
}

/**
 * 流式历史的块级状态机。终端/agent 各自成块（渲染为卡片），note 为纯行。
 * 块以自增 id 定位更新；数组封顶避免无限增长。
 */
export function useTranscript(): TranscriptApi {
  const [blocks, setBlocks] = useState<Block[]>([])
  const nextId = useRef(0)
  // 当前正在聚合的 agent 块 id；null 表示无未完 agent 轮次
  const agentId = useRef<number | null>(null)
  // ACP toolCallId → 卡片 id：tool_call_update 只带 id，靠这张表找回卡片
  const toolIds = useRef(new Map<string, number>())

  const push = useCallback((block: Block) => {
    setBlocks((prev) => [...prev, block].slice(-BLOCK_LIMIT))
  }, [])

  const patch = useCallback((id: number, fn: (b: Block) => Block) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? fn(b) : b)))
  }, [])

  const addTerminal = useCallback(
    (
      command: string,
      args: string[],
      cwd: string,
      options?: { label?: string; prompt?: "shell" | "terminal"; fullscreen?: boolean },
    ) => {
      agentId.current = null
      const id = nextId.current++
      push({
        id,
        kind: "terminal",
        command,
        args,
        label: options?.label ?? [command, ...args].join(" "),
        cwd,
        prompt: options?.prompt ?? "terminal",
        fullscreen: options?.fullscreen ?? false,
        state: "running",
      })
      return id
    },
    [push],
  )

  const addPrompt = useCallback(
    (text: string, cwd: string) => {
      agentId.current = null
      push({ id: nextId.current++, kind: "prompt", text, cwd })
    },
    [push],
  )

  const upsertTool = useCallback(
    (call: {
      toolCallId: string
      title?: string
      toolKind?: string
      status?: "pending" | "in_progress" | "completed" | "failed"
      lines?: string[]
    }) => {
      const existing = toolIds.current.get(call.toolCallId)
      if (existing === undefined) {
        agentId.current = null
        const id = nextId.current++
        toolIds.current.set(call.toolCallId, id)
        push({
          id,
          kind: "tool",
          toolCallId: call.toolCallId,
          title: call.title ?? call.toolCallId,
          toolKind: call.toolKind,
          status: call.status ?? "pending",
          lines: call.lines ?? [],
        })
        return
      }
      patch(existing, (b) =>
        b.kind === "tool"
          ? {
              ...b,
              title: call.title ?? b.title,
              toolKind: call.toolKind ?? b.toolKind,
              status: call.status ?? b.status,
              lines: call.lines ?? b.lines,
            }
          : b,
      )
    },
    [patch, push],
  )

  const addPermission = useCallback(
    (permission: {
      toolCallId: string
      title: string
      options: Array<{ optionId: string; name: string; kind: string }>
    }) => {
      agentId.current = null
      const id = nextId.current++
      push({ id, kind: "permission", ...permission, state: "pending" })
      return id
    },
    [push],
  )

  const resolvePermission = useCallback(
    (id: number, chosen: string, auto: boolean) => {
      patch(id, (b) => (b.kind === "permission" ? { ...b, state: "decided", chosen, auto } : b))
    },
    [patch],
  )

  const addCommand = useCallback(
    (name: string, input: string, cwd: string, lines: string[] = []) => {
      agentId.current = null
      const id = nextId.current++
      push({ id, kind: "command", name, input, cwd, lines })
      return id
    },
    [push],
  )

  const setCommandLines = useCallback(
    (id: number, lines: string[]) => {
      patch(id, (b) => (b.kind === "command" ? { ...b, lines } : b))
    },
    [patch],
  )

  const closeTerminal = useCallback(
    (id: number, exitCode: number) => {
      patch(id, (b) => (b.kind === "terminal" ? { ...b, state: "exited", exitCode } : b))
    },
    [patch],
  )

  const appendAgentChunk = useCallback(
    (text: string) => {
      if (agentId.current === null) {
        const id = nextId.current++
        agentId.current = id
        push({ id, kind: "agent", text })
        return
      }
      patch(agentId.current, (b) => (b.kind === "agent" ? { ...b, text: b.text + text } : b))
    },
    [patch, push],
  )

  const flushAgent = useCallback(() => {
    agentId.current = null
  }, [])

  const addNote = useCallback(
    (level: "system" | "error", text: string) => {
      agentId.current = null
      push({ id: nextId.current++, kind: "note", level, text })
    },
    [push],
  )

  const clear = useCallback(() => {
    agentId.current = null
    toolIds.current.clear()
    setBlocks([])
  }, [])

  return {
    blocks,
    addTerminal,
    addPrompt,
    upsertTool,
    addPermission,
    resolvePermission,
    addCommand,
    setCommandLines,
    closeTerminal,
    appendAgentChunk,
    flushAgent,
    addNote,
    clear,
  }
}
