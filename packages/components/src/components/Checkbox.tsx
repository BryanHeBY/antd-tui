import { useRef, type ReactNode } from "react"
import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：[x] / [ ]。聚焦后 Enter 或 Space 切换。
 */

export interface CheckboxProps {
  /** 同 antd：受控选中态 */
  checked?: boolean
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 类似 antd onChange 但参数不同：直接回传 checked（终端无 DOM 事件对象） */
  tuiOnChange?: (checked: boolean) => void
  children?: ReactNode
}

function CheckboxBase({ checked = false, disabled = false, tuiOnChange, children }: CheckboxProps) {
  const token = useToken()
  const boxRef = useRef<BoxRenderable | null>(null)
  const toggle = () => {
    if (!disabled) tuiOnChange?.(!checked)
  }
  const { focused } = useFocusable({
    kind: "action",
    disabled,
    onActivate: toggle,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })

  useKeyboard((key) => {
    if (focused && key.name === "space") toggle()
  })

  const color = disabled
    ? token.colorTextDisabled
    : focused
      ? token.colorPrimary
      : checked
        ? token.colorPrimary
        : token.colorText

  return (
    <box
      ref={boxRef}
      style={{ flexDirection: "row", minHeight: 1 }}
      onMouseDown={toggle}
    >
      <text fg={color}>
        {checked ? "[x] " : "[ ] "}
        {focused ? <b>{children}</b> : children}
      </text>
    </box>
  )
}

export interface CheckboxOption {
  label: string
  value: string | number
  disabled?: boolean
}

export interface CheckboxGroupProps {
  /** 同 antd：选项列表（字符串数组时 label 与 value 相同） */
  options?: Array<CheckboxOption | string>
  /** 同 antd：受控选中值数组 */
  value?: Array<string | number>
  /** 同 antd：选中值变化回调（antd 首参即选中值数组，语义一致） */
  onChange?: (checkedValue: Array<string | number>) => void
  /** 同 antd：整组禁用 */
  disabled?: boolean
  /** TUI 扩展：排列方向（终端宽度有限，默认纵向；antd 无此字段） */
  tuiDirection?: "horizontal" | "vertical"
}

function normalize(options: Array<CheckboxOption | string> = []): CheckboxOption[] {
  return options.map((o) => (typeof o === "string" ? { label: o, value: o } : o))
}

function CheckboxGroup({
  options,
  value = [],
  onChange,
  disabled = false,
  tuiDirection = "vertical",
}: CheckboxGroupProps) {
  const list = normalize(options)
  return (
    <box
      style={{
        flexDirection: tuiDirection === "horizontal" ? "row" : "column",
        gap: tuiDirection === "horizontal" ? 2 : 0,
      }}
    >
      {list.map((option) => (
        <CheckboxBase
          key={String(option.value)}
          checked={value.includes(option.value)}
          disabled={disabled || option.disabled}
          tuiOnChange={(checked) => {
            const next = checked
              ? [...value, option.value]
              : value.filter((v) => v !== option.value)
            onChange?.(next)
          }}
        >
          {option.label}
        </CheckboxBase>
      ))}
    </box>
  )
}

export const Checkbox = Object.assign(CheckboxBase, { Group: CheckboxGroup })
