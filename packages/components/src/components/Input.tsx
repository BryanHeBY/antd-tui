import { useToken } from "../theme"
import { useFocusable } from "../focus"
import { toBoxStyle, type CssLikeStyle } from "../style"
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
  /** 同 antd：最大输入长度（超出的键入/粘贴被丢弃） */
  maxLength?: number
  /** 同 antd：CSS 布局样式；可用 width / flex 控制栅格中的宽度 */
  style?: CssLikeStyle
  /** 类似 antd onPressEnter，但无 DOM 事件参数；未提供时默认移动焦点到下一个控件 */
  tuiOnPressEnter?: () => void
  /** TUI 扩展：无边框单行模式，适合内联过滤栏等 height=1 场景 */
  compact?: boolean
}

export function InputBase({
  value,
  tuiOnChange,
  placeholder,
  disabled = false,
  maxLength,
  style,
  tuiOnPressEnter,
  compact = false,
}: InputProps) {
  const token = useToken()
  const { focused, focusNext, requestFocus } = useFocusable({ kind: "input", disabled })

  if (compact) {
    return (
      <box
        style={{
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          height: 1,
          ...toBoxStyle(style),
        }}
        onMouseDown={() => {
          if (!disabled) requestFocus()
        }}
      >
        <input
          value={value ?? ""}
          maxLength={maxLength}
          placeholder={placeholder ?? ""}
          focused={focused && !disabled}
          onInput={(v: string) => tuiOnChange?.(v)}
          onSubmit={() => {
            if (tuiOnPressEnter) tuiOnPressEnter()
            else focusNext()
          }}
          width="100%"
        />
      </box>
    )
  }

  return (
    <box
      border
      style={{
        borderStyle: token.borderStyle,
        borderColor: focused ? token.colorPrimaryHover : token.colorBorder,
        // antd Input 在可用行宽内默认占满；终端列布局中也不能被压缩。
        width: "100%",
        flexShrink: 0,
        height: 3,
        paddingLeft: 1,
        paddingRight: 1,
        ...toBoxStyle(style),
      }}
      onMouseDown={() => {
        if (!disabled) requestFocus()
      }}
    >
      <input
        value={value ?? ""}
        maxLength={maxLength}
        placeholder={placeholder ?? ""}
        focused={focused && !disabled}
        onInput={(v: string) => tuiOnChange?.(v)}
        onSubmit={() => {
          if (tuiOnPressEnter) tuiOnPressEnter()
          else focusNext()
        }}
        style={{ flexGrow: 1 }}
      />
    </box>
  )
}

/** 复合组件：对齐 antd 的 Input.TextArea */
export const Input = Object.assign(InputBase, { TextArea })
