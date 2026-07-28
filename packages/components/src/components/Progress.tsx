import { TextAttributes } from "@opentui/core"
import { useToken } from "../theme"
import { useMeasuredWidth } from "../measure"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：█ 填充 + ░ 轨道，右侧显示百分比或状态字符。
 */
export interface ProgressProps {
  /** 同 antd：百分比（0-100） */
  percent?: number
  /** 同 antd：状态（exception 为红色、success 为绿色） */
  status?: "normal" | "active" | "success" | "exception"
  /** 同 antd：显示右侧信息 */
  showInfo?: boolean
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
}

const INFO_WIDTH = 6
const TRACK_MIN_WIDTH = 10
const FULL_WIDTH_FALLBACK = 30

export function Progress({
  percent = 0,
  status = "normal",
  showInfo = true,
  style,
}: ProgressProps) {
  const token = useToken()
  const { boxRef, width: boxWidth } = useMeasuredWidth()
  const clamped = Math.min(Math.max(percent, 0), 100)
  // percent 达到 100 时 antd 默认转为 success 态
  const effective = status === "normal" && clamped >= 100 ? "success" : status

  // 进度条是字形前景（█/░）而非真背景填充，必须取亮端才可见
  const barColor =
    effective === "exception"
      ? token.colorError
      : effective === "success"
        ? token.colorSuccess
        : token.colorPrimaryHover

  const total = boxWidth ?? FULL_WIDTH_FALLBACK
  const width = Math.max(TRACK_MIN_WIDTH, total - (showInfo ? INFO_WIDTH : 0))
  const filledCount = Math.round((clamped / 100) * width)
  const info =
    effective === "success" ? "  ✓" : effective === "exception" ? "  ✗" : ` ${clamped}%`

  return (
    <box
      ref={boxRef}
      style={{ flexDirection: "row", minHeight: 1, width: "100%", ...toBoxStyle(style) }}
    >
      <text attributes={TextAttributes.BOLD}>
        <span fg={barColor}>{"█".repeat(filledCount)}</span>
        <span fg={token.colorBorder}>{"░".repeat(Math.max(0, width - filledCount))}</span>
      </text>
      {showInfo ? <text attributes={TextAttributes.BOLD} fg={barColor}>{info}</text> : null}
    </box>
  )
}
