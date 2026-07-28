import { useToken } from "../theme"
import { useFocusable } from "../focus"
import { TextArea, type TextAreaProps } from "./TextArea"

export type { TextAreaProps }

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 */
export interface InputProps {
  /** 同 antd：受控值 */
  value?: string
  /** 类似 antd onChange 但参数不同：直接回传字符串值（终端无 DOM ChangeEvent） */
  tuiOnChange?: (value: string) => void
  /** 同 antd：占位文本 */
  placeholder?: string
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 同 antd：Enter 键回调（无 event 参数）；未提供时默认移动焦点到下一个控件 */
  onPressEnter?: () => void
}

export function InputBase({
  value,
  tuiOnChange,
  placeholder,
  disabled = false,
  onPressEnter,
}: InputProps) {
  const token = useToken()
  const { focused, focusNext, requestFocus } = useFocusable({ kind: "input", disabled })

  return (
    <box
      border
      style={{
        borderStyle: token.borderStyle,
        borderColor: focused ? token.colorPrimaryHover : token.colorBorder,
        height: 3,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      onMouseDown={() => {
        if (!disabled) requestFocus()
      }}
    >
      <input
        value={value ?? ""}
        placeholder={placeholder ?? ""}
        focused={focused && !disabled}
        onInput={(v: string) => tuiOnChange?.(v)}
        onSubmit={() => {
          if (onPressEnter) onPressEnter()
          else focusNext()
        }}
        style={{ flexGrow: 1 }}
      />
    </box>
  )
}

/** 复合组件：对齐 antd 的 Input.TextArea */
export const Input = Object.assign(InputBase, { TextArea })
