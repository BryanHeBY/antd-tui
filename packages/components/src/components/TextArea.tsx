import { useEffect, useRef } from "react"
import type { TextareaRenderable } from "@opentui/core"
import { useToken } from "../theme"
import { useFocusable } from "../focus"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 *
 * 终端多行编辑基于 OpenTUI textarea。value 变化时会回写缓冲区，
 * 保持与 antd TextArea 一致的受控语义。
 */
export interface TextAreaProps {
  /** 同 antd：受控值 */
  value?: string
  /** 同 antd：非受控初值 */
  defaultValue?: string
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
  value,
  defaultValue,
  tuiOnChange,
  placeholder,
  disabled = false,
  rows = 3,
}: TextAreaProps) {
  const token = useToken()
  const areaRef = useRef<TextareaRenderable | null>(null)
  const { focused, requestFocus } = useFocusable({ kind: "input", disabled })

  useEffect(() => {
    const area = areaRef.current
    if (area && value !== undefined && area.plainText !== value) area.setText(value)
  }, [value])

  return (
    <box
      border
      style={{
        borderStyle: token.borderStyle,
        borderColor: focused ? token.colorPrimaryHover : token.colorBorder,
        height: rows + 2,
      }}
      onMouseDown={() => {
        if (!disabled) requestFocus()
      }}
    >
      <textarea
        ref={areaRef}
        initialValue={value ?? defaultValue ?? ""}
        placeholder={placeholder ?? ""}
        focused={focused && !disabled}
        onContentChange={() => tuiOnChange?.(areaRef.current?.plainText ?? "")}
        style={{ flexGrow: 1 }}
      />
    </box>
  )
}
