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
    options?: { label?: string; prompt?: "shell" | "terminal" },
  ) => number
  /** 记录一条交给 agent 的用户输入。 */
  addPrompt: (text: string, cwd: string) => void
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
      options?: { label?: string; prompt?: "shell" | "terminal" },
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
    setBlocks([])
  }, [])

  return {
    blocks,
    addTerminal,
    addPrompt,
    closeTerminal,
    appendAgentChunk,
    flushAgent,
    addNote,
    clear,
  }
}
