import { useRef, useState } from "react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 */
export interface InputNumberProps {
  /** 同 antd：受控值 */
  value?: number
  /** 同 antd：值变化回调，清空/非法时回传 null */
  onChange?: (value: number | null) => void
  /** 同 antd：占位文本 */
  placeholder?: string
  /** 同 antd：禁用 */
  disabled?: boolean
}

const NUMERIC_RE = /^-?\d*\.?\d*$/

/**
 * 数字输入框：内部维护草稿字符串，仅当内容是合法数字时向外提交 number。
 *
 * 草稿同时存于 state（驱动渲染）与 ref（供事件回调读最新值）：
 * 连续快速按键之间 React 可能尚未重渲染，事件闭包里的 state 是旧值，
 * 拒绝非法输入时必须依据 ref 里的最新草稿回写 native 缓冲区。
 */
export function InputNumber({ value, onChange, placeholder, disabled = false }: InputNumberProps) {
  const token = useToken()
  const { focused, focusNext, requestFocus } = useFocusable({ kind: "input", disabled })
  const initial = value != null ? String(value) : ""
  const [draft, setDraft] = useState<string>(initial)
  const draftRef = useRef<string>(initial)
  const lastPropValue = useRef(value)
  const inputRef = useRef<{ value: string } | null>(null)

  // 外部受控值变化时（如表单 reset），同步草稿；null/undefined 均视为空
  if (lastPropValue.current !== value) {
    lastPropValue.current = value
    const draftNum =
      draftRef.current === "" || draftRef.current === "-" ? undefined : Number(draftRef.current)
    if ((value ?? undefined) !== draftNum) {
      const next = value != null ? String(value) : ""
      draftRef.current = next
      setDraft(next)
    }
  }

  const commit = (raw: string) => {
    if (raw === draftRef.current) return
    if (!NUMERIC_RE.test(raw)) {
      // 拒绝非法字符：React prop 不会变化，需手动回写 native 缓冲区
      if (inputRef.current && inputRef.current.value !== draftRef.current) {
        inputRef.current.value = draftRef.current
      }
      return
    }
    draftRef.current = raw
    setDraft(raw)
    if (raw === "" || raw === "-" || raw === ".") {
      onChange?.(null)
    } else {
      const num = Number(raw)
      onChange?.(Number.isNaN(num) ? null : num)
    }
  }

  return (
    <box
      border
      style={{
        borderStyle: token.borderStyle,
        borderColor: focused ? token.colorPrimary : token.colorBorder,
        height: 3,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      onMouseDown={() => {
        if (!disabled) requestFocus()
      }}
    >
      <input
        ref={inputRef as never}
        value={draft}
        placeholder={placeholder ?? ""}
        focused={focused && !disabled}
        onInput={commit}
        onSubmit={() => focusNext()}
        style={{ flexGrow: 1 }}
      />
    </box>
  )
}
