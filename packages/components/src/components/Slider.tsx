import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"
import { useMeasuredWidth } from "../measure"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：━━━●────── 轨道；聚焦后 ←/→ 按 step 调节，Home/End 到端点。
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
  const { focused, isActiveScope } = useFocusable({
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

  const width = Math.max(TRACK_MIN_WIDTH, (boxWidth ?? 20) - (tuiShowValue ? 8 : 0))
  const ratio = max === min ? 0 : (current - min) / (max - min)
  const knobIndex = Math.round(ratio * (width - 1))
  const filled = "━".repeat(knobIndex)
  const rest = "─".repeat(Math.max(0, width - knobIndex - 1))
  const trackColor = disabled ? token.colorTextDisabled : token.colorPrimary
  const restColor = disabled ? token.colorTextDisabled : token.colorBorder

  return (
    <box
      ref={boxRef}
      style={{ flexDirection: "row", minHeight: 1, alignItems: "center", ...toBoxStyle(style) }}
    >
      <text>
        <span fg={trackColor}>{filled}</span>
        <span fg={focused ? "#ffffff" : trackColor}>{focused ? "◉" : "●"}</span>
        <span fg={restColor}>{rest}</span>
      </text>
      {tuiShowValue ? (
        <text fg={disabled ? token.colorTextDisabled : token.colorText}> {String(current)}</text>
      ) : null}
    </box>
  )
}
