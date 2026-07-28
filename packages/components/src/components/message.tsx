import { useCallback, useMemo, useRef, useState, type ReactNode } from "react"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 *
 * 对齐 antd v5 的 hook 用法：const [api, holder] = message.useMessage()。
 * 终端无全局 DOM 容器，因此只提供 hook 形态（antd 的静态 message.success 不移植）。
 */

export type MessageType = "success" | "error" | "info" | "warning" | "loading"

export interface MessageArgs {
  /** 同 antd：提示内容 */
  content: ReactNode
  /** 同 antd：自动关闭秒数，0 表示不自动关闭 */
  duration?: number
  /** 同 antd：关闭时回调 */
  onClose?: () => void
}

type MessageInput = ReactNode | MessageArgs

export interface MessageInstance {
  success: (args: MessageInput) => void
  error: (args: MessageInput) => void
  info: (args: MessageInput) => void
  warning: (args: MessageInput) => void
  loading: (args: MessageInput) => void
  /** 同 antd：关闭全部提示 */
  destroy: () => void
}

interface MessageItem {
  id: number
  type: MessageType
  content: ReactNode
}

const ICONS: Record<MessageType, string> = {
  success: "✓",
  error: "✗",
  info: "i",
  warning: "!",
  loading: "◌",
}

const DEFAULT_DURATION = 3

function normalize(input: MessageInput): MessageArgs {
  if (input !== null && typeof input === "object" && "content" in (input as object)) {
    return input as MessageArgs
  }
  return { content: input as ReactNode }
}

function MessageList({ items }: { items: MessageItem[] }) {
  const token = useToken()
  if (items.length === 0) return null
  return (
    <box
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 1000,
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {items.map((item) => {
        const color =
          item.type === "success"
            ? token.colorSuccess
            : item.type === "error"
              ? token.colorError
              : item.type === "warning"
                ? token.colorWarning
                : token.colorPrimaryHover
        return (
          <box
            key={item.id}
            style={{
              backgroundColor: "#1f1f1f",
              paddingLeft: 1,
              paddingRight: 1,
              minHeight: 1,
              flexDirection: "row",
            }}
          >
            <text fg={color} bg="#1f1f1f">
              {ICONS[item.type]} {item.content}
            </text>
          </box>
        )
      })}
    </box>
  )
}

/**
 * 对齐 antd v5：返回 [api, holder]，holder 需渲染进组件树。
 */
export function useMessage(): [MessageInstance, ReactNode] {
  const [items, setItems] = useState<MessageItem[]>([])
  const seq = useRef(0)
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const remove = useCallback((id: number, onClose?: () => void) => {
    setItems((list) => list.filter((item) => item.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
    onClose?.()
  }, [])

  const open = useCallback(
    (type: MessageType, input: MessageInput) => {
      const { content, duration = DEFAULT_DURATION, onClose } = normalize(input)
      const id = ++seq.current
      setItems((list) => [...list, { id, type, content }])
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => remove(id, onClose), duration * 1000),
        )
      }
    },
    [remove],
  )

  const api = useMemo<MessageInstance>(
    () => ({
      success: (args) => open("success", args),
      error: (args) => open("error", args),
      info: (args) => open("info", args),
      warning: (args) => open("warning", args),
      loading: (args) => open("loading", args),
      destroy: () => {
        for (const timer of timers.current.values()) clearTimeout(timer)
        timers.current.clear()
        setItems([])
      },
    }),
    [open],
  )

  return [api, <MessageList key="antd-tui-message" items={items} />]
}

export const message = { useMessage }
