import { useCallback, useRef, useState } from "react"
import type { ConversationEntry, ConversationKind } from "./types"

const LOG_LIMIT = 500

export interface TranscriptApi {
  entries: ConversationEntry[]
  /** 流式未完行：chunk 拼接缓冲，遇 \n 才沉淀成正式行 */
  partial: ConversationEntry | null
  /** 流式片段：只拼接，完整行（含 \n）才入 transcript */
  appendChunk: (text: string, kind?: ConversationKind) => void
  /** 整条非流式消息：先冲刷未完的流式行，保证时间顺序 */
  appendMessage: (kind: ConversationKind, text: string) => void
  /** 冲刷未完行成正式行（轮次结束时调） */
  flush: () => void
  /** 清空（clear 内建） */
  clear: () => void
}

/**
 * 对话 transcript 状态机（移植自 vibe-tui/VibeApp 的 pushLines/appendChunk/
 * flushPartial/appendMessage）。命令输出与 agent 流式回复都经 appendChunk 逐行沉淀。
 */
export function useTranscript(): TranscriptApi {
  const [entries, setEntries] = useState<ConversationEntry[]>([])
  const [partial, setPartial] = useState<ConversationEntry | null>(null)
  const partialRef = useRef<ConversationEntry | null>(null)

  const pushLines = useCallback((kind: ConversationKind, lines: string[]) => {
    // 命令输出可能含空行（如 ls 的空目录），保留；仅丢尾随的纯空白噪声由调用方决定
    if (lines.length > 0) {
      setEntries((prev) => [...prev, ...lines.map((text) => ({ kind, text }))].slice(-LOG_LIMIT))
    }
  }, [])

  const flush = useCallback(() => {
    const entry = partialRef.current
    partialRef.current = null
    setPartial(null)
    if (entry && entry.text.trim() !== "") pushLines(entry.kind, [entry.text])
  }, [pushLines])

  const appendChunk = useCallback(
    (text: string, kind: ConversationKind = "agent") => {
      // 不同来源不能混进同一未完行（如系统提示插在 agent 流式回复中间）
      if (partialRef.current && partialRef.current.kind !== kind) flush()
      const merged = (partialRef.current?.text ?? "") + text
      const parts = merged.split("\n")
      const rest = parts.pop() ?? ""
      partialRef.current = rest === "" ? null : { kind, text: rest }
      setPartial(partialRef.current)
      pushLines(kind, parts)
    },
    [flush, pushLines],
  )

  const appendMessage = useCallback(
    (kind: ConversationKind, text: string) => {
      flush()
      pushLines(kind, [text])
    },
    [flush, pushLines],
  )

  const clear = useCallback(() => {
    partialRef.current = null
    setPartial(null)
    setEntries([])
  }, [])

  return { entries, partial, appendChunk, appendMessage, flush, clear }
}
