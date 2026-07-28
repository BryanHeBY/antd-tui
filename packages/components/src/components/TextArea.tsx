import { useRef } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { useToken } from "../theme"
import { useFocusable } from "../focus"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 *
 * 终端多行编辑基于 OpenTUI textarea：它以 initialValue 初始化并自行维护缓冲区，
 * 因此这里是「初值 + 变更上报」的半受控形态（antd TextArea 为完全受控）。
 */
export interface TextAreaProps {
  /** 类似 antd value 但为初值语义：后续编辑由终端缓冲区维护，不做外部回写 */
  tuiDefaultValue?: string
  /** 类似 antd onChange 但参数不同：直接回传当前文本（终端无 DOM ChangeEvent） */
  tuiOnChange?: (value: string) => void
  /** 同 antd：占位文本 */
  placeholder?: string
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 同 antd：可见行数 */
  rows?: number
}

export function TextArea({
  tuiDefaultValue,
  tuiOnChange,
  placeholder,
  disabled = false,
  rows = 3,
}: TextAreaProps) {
  const token = useToken()
  const areaRef = useRef<TextareaRenderable | null>(null)
  const { focused, requestFocus } = useFocusable({ kind: "input", disabled })

  return (
    <box
      border
      style={{
        borderStyle: token.borderStyle,
        borderColor: focused ? token.colorPrimary : token.colorBorder,
        height: rows + 2,
      }}
      onMouseDown={() => {
        if (!disabled) requestFocus()
      }}
    >
      <textarea
        ref={areaRef}
        initialValue={tuiDefaultValue ?? ""}
        placeholder={placeholder ?? ""}
        focused={focused && !disabled}
        onContentChange={() => tuiOnChange?.(areaRef.current?.plainText ?? "")}
        style={{ flexGrow: 1 }}
      />
    </box>
  )
}
