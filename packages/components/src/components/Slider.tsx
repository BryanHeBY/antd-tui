import { TextAttributes } from "@opentui/core"
import type { MouseEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"
import { useMeasuredWidth } from "../measure"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：━━━●────── 轨道；聚焦后 ←/→ 按 step 调节，Home/End 到端点；鼠标点击/拖动轨道换值。
 */
export interface SliderProps {
  /** 同 antd：最小值 */
  min?: number
  /** 同 antd：最大值 */
  max?: number
  /** 同 antd：步长 */
  step?: number
  /** 同 antd：受控值 */
  value?: number
  /** 同 antd：值变化回调（antd 首参即数值，语义一致） */
  onChange?: (value: number) => void
  /** 同 antd：禁用 */
  disabled?: boolean
  /** TUI 扩展：在数值轨道右侧显示当前值（antd 用 tooltip 展示，终端无 hover） */
  tuiShowValue?: boolean
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
}

const TRACK_MIN_WIDTH = 10

export function Slider({
  min = 0,
  max = 100,
  step = 1,
  value,
  onChange,
  disabled = false,
  tuiShowValue = true,
  style,
}: SliderProps) {
  const token = useToken()
  const { boxRef, width: boxWidth } = useMeasuredWidth()
  const current = Math.min(Math.max(value ?? min, min), max)

  // 注册为 input 类：方向键归组件消费（调节数值），用 Tab 离开
  const { focused, isActiveScope, requestFocus } = useFocusable({
    kind: "input",
    disabled,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })

  const emit = (next: number) => {
    const clamped = Math.min(Math.max(next, min), max)
    // 按 step 对齐，消除浮点累积误差
    const aligned = Math.round((clamped - min) / step) * step + min
    const fixed = Number(aligned.toFixed(10))
    if (fixed !== current) onChange?.(fixed)
  }

  useKeyboard((key) => {
    if (!focused || disabled || !isActiveScope()) return
    switch (key.name) {
      case "left":
        emit(current - step)
        break
      case "right":
        emit(current + step)
        break
      case "home":
        emit(min)
        break
      case "end":
        emit(max)
        break
    }
  })

  // 数值区宽度按实际显示内容预留（长数值如 12345.5 不再溢出行宽）
  const valueWidth = tuiShowValue ? String(current).length + 1 : 0
  const width = Math.max(TRACK_MIN_WIDTH, (boxWidth ?? 20) - valueWidth)
  const ratio = max === min ? 0 : (current - min) / (max - min)
  const knobIndex = Math.round(ratio * (width - 1))
  const filled = "━".repeat(knobIndex)
  const rest = "─".repeat(Math.max(0, width - knobIndex - 1))
  // 轨道是字形前景（━/─）而非真背景填充，已走过的一段取亮端才可见
  const trackColor = disabled ? token.colorTextDisabled : token.colorPrimaryHover
  const restColor = disabled ? token.colorTextDisabled : token.colorBorder

  // 点击/拖动：把鼠标横坐标换算成轨道比例再取值（emit 会按 step 对齐）
  const handleMouse = (event: MouseEvent) => {
    if (disabled) return
    const el = boxRef.current
    if (!el) return
    const pos = Math.min(Math.max(event.x - el.x, 0), width - 1)
    const nextRatio = width <= 1 ? 0 : pos / (width - 1)
    emit(min + nextRatio * (max - min))
  }

  return (
    <box
      ref={boxRef}
      style={{ flexDirection: "row", minHeight: 1, alignItems: "center", ...toBoxStyle(style) }}
      onMouseDown={(event) => {
        requestFocus()
        handleMouse(event)
      }}
      onMouseDrag={handleMouse}
    >
      <text attributes={TextAttributes.BOLD}>
        <span fg={trackColor}>{filled}</span>
        <span fg={focused ? "#ffffff" : trackColor}>{focused ? "◉" : "●"}</span>
        <span fg={restColor}>{rest}</span>
      </text>
      {tuiShowValue ? (
        <text attributes={TextAttributes.BOLD} fg={disabled ? token.colorTextDisabled : token.colorText}> {String(current)}</text>
      ) : null}
    </box>
  )
}
