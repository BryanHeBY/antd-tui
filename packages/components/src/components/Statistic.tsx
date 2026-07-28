import type { ReactNode } from "react"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：标题行（次要色）+ 数值行（前缀 / 数值 / 后缀）。
 */
export interface StatisticProps {
  /** 同 antd：标题 */
  title?: ReactNode
  /** 同 antd：数值 */
  value?: string | number
  /** 同 antd：小数位数（value 为数字时生效） */
  precision?: number
  /** 同 antd：数值前缀 */
  prefix?: ReactNode
  /** 同 antd：数值后缀 */
  suffix?: ReactNode
  /** 类似 antd valueStyle 但仅支持语义色（终端无 CSS） */
  tuiValueType?: "default" | "success" | "warning" | "danger"
}

export function Statistic({
  title,
  value,
  precision,
  prefix,
  suffix,
  tuiValueType = "default",
}: StatisticProps) {
  const token = useToken()
  const valueColor =
    tuiValueType === "success"
      ? token.colorSuccess
      : tuiValueType === "warning"
        ? token.colorWarning
        : tuiValueType === "danger"
          ? token.colorError
          : token.colorText

  const text =
    typeof value === "number" && precision !== undefined
      ? value.toFixed(precision)
      : value === undefined
        ? "-"
        : String(value)

  return (
    <box style={{ flexDirection: "column" }}>
      {title ? <text fg={token.colorTextSecondary}>{title}</text> : null}
      <text fg={valueColor}>
        {prefix ? <span>{String(prefix)}</span> : null}
        <b>{text}</b>
        {suffix ? <span>{String(suffix)}</span> : null}
      </text>
    </box>
  )
}
