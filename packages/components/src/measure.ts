import { useEffect, useRef, useState } from "react"
import type { BoxRenderable, CliRenderer } from "@opentui/core"
import { useRenderer } from "@opentui/react"

interface ResizeStore {
  listeners: Set<() => void>
  onResize: () => void
}

/**
 * 一块终端画布只需要一个 renderer.resize 监听器。像进度条、Divider、MeterBar
 * 这样的自测量组件可能同时存在数十个；由 store 再分发可以避免触发 EventEmitter
 * 的监听器上限，也不会在 resize 时为每个组件分别注册底层回调。
 */
const resizeStores = new WeakMap<CliRenderer, ResizeStore>()

function getResizeStore(renderer: CliRenderer): ResizeStore {
  const existing = resizeStores.get(renderer)
  if (existing) return existing

  const listeners = new Set<() => void>()
  const store: ResizeStore = {
    listeners,
    onResize: () => {
      for (const listener of listeners) listener()
    },
  }
  resizeStores.set(renderer, store)
  return store
}

function subscribeToResize(renderer: CliRenderer, listener: () => void): () => void {
  const store = getResizeStore(renderer)
  store.listeners.add(listener)
  if (store.listeners.size === 1) renderer.on("resize", store.onResize)

  return () => {
    store.listeners.delete(listener)
    if (store.listeners.size === 0) renderer.off("resize", store.onResize)
  }
}

/**
 * 测量容器布局后的实际宽度。
 *
 * OpenTUI 的 yoga 布局在 React 提交之后由渲染循环计算，且 core 没有可用的
 * 尺寸事件（LayoutEvents.RESIZED 定义了但从不发射），因此首帧渲染时 ref 上
 * 读不到宽度。这里在挂载后轮询首个布局结果触发一次重渲染，终端 resize 时
 * 再重新测量，避免「首帧用兜底宽度、点击后才变对」的跳变。
 */
export function useMeasuredWidth(): {
  boxRef: React.RefObject<BoxRenderable | null>
  width: number | null
} {
  const boxRef = useRef<BoxRenderable | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [resizeVersion, setResizeVersion] = useState(0)
  const renderer = useRenderer()

  useEffect(() => {
    return subscribeToResize(renderer, () => setResizeVersion((version) => version + 1))
  }, [renderer])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      if (cancelled) return
      const w = boxRef.current?.width
      if (w && w > 0) setWidth(w)
      else timer = setTimeout(measure, 16)
    }
    measure()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [resizeVersion])

  return { boxRef, width }
}
