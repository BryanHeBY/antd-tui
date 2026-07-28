import { useEffect, useRef, useState } from "react"
import type { BoxRenderable } from "@opentui/core"
import { useOnResize } from "@opentui/react"

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

  useEffect(() => {
    let cancelled = false
    const measure = () => {
      if (cancelled) return
      const w = boxRef.current?.width
      if (w && w > 0) setWidth(w)
      else setTimeout(measure, 16)
    }
    measure()
    return () => {
      cancelled = true
    }
  }, [])

  useOnResize(() => {
    // 终端 resize 后布局同样是异步重算，等下一帧再量
    setTimeout(() => {
      const w = boxRef.current?.width
      if (w && w > 0) setWidth(w)
    }, 16)
  })

  return { boxRef, width }
}
