import type { ReactNode } from "react"
import { useToken } from "../theme"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 表单条目：label 行 + 控件 + 提示/错误行。作为 Formily 的 x-decorator 使用。
 */
export interface FormItemProps {
  /** 同 antd：标签 */
  label?: string
  /** 同 antd：必填标记 */
  required?: boolean
  /** 同 antd：提示文案（validateStatus 为 error 时以错误色展示） */
  help?: string
  /** 同 antd（子集）：校验状态 */
  validateStatus?: "error"
  children?: ReactNode
}

export function FormItem({
  label,
  required = false,
  help,
  validateStatus,
  children,
}: FormItemProps) {
  const token = useToken()

  return (
    <box style={{ flexDirection: "column" }}>
      {label ? (
        <text fg={token.colorText}>
          {required ? <span fg={token.colorError}>* </span> : null}
          {label}
        </text>
      ) : null}
      {children}
      {help ? (
        <text fg={validateStatus === "error" ? token.colorError : token.colorTextSecondary}>
          {help}
        </text>
      ) : null}
    </box>
  )
}
