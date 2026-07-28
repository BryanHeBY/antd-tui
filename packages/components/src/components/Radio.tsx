import { useRef, type ReactNode } from "react"
import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：(o) / ( )；optionType="button" 时渲染为色块按钮组。
 */

export interface RadioProps {
  /** 同 antd：受控选中态 */
  checked?: boolean
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 类似 antd onChange 但参数不同：直接回传 checked（终端无 DOM 事件对象） */
  tuiOnChange?: (checked: boolean) => void
  /** TUI 扩展：按钮形态（由 Radio.Group optionType 传入） */
  tuiButtonStyle?: boolean
  children?: ReactNode
}

function RadioBase({
  checked = false,
  disabled = false,
  tuiOnChange,
  tuiButtonStyle = false,
  children,
}: RadioProps) {
  const token = useToken()
  const boxRef = useRef<BoxRenderable | null>(null)
  const select = () => {
    if (!disabled && !checked) tuiOnChange?.(true)
  }
  const { focused, isActiveScope, requestFocus } = useFocusable({
    kind: "action",
    disabled,
    onActivate: select,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })

  useKeyboard((key) => {
    if (focused && isActiveScope() && key.name === "space") select()
  })

  // 浏览器直觉：点击控件同时把焦点转移过去
  const handleMouseDown = () => {
    requestFocus()
    select()
  }

  if (tuiButtonStyle) {
    const backgroundColor = disabled
      ? "#262626"
      : checked
        ? token.colorPrimary
        : focused
          ? "#e6e6e6"
          : "#373737"
    const textColor = disabled
      ? token.colorTextDisabled
      : checked
        ? "#ffffff"
        : focused
          ? "#141414"
          : "#ffffff"
    return (
      <box
        ref={boxRef}
        style={{
          backgroundColor,
          minHeight: 1,
          paddingLeft: 1,
          paddingRight: 1,
          alignItems: "center",
          justifyContent: "center",
        }}
        onMouseDown={handleMouseDown}
      >
        <text fg={textColor} bg={backgroundColor}>
          {focused ? <b>{children}</b> : children}
        </text>
      </box>
    )
  }

  const color = disabled
    ? token.colorTextDisabled
    : focused || checked
      ? token.colorPrimaryHover
      : token.colorText

  return (
    <box ref={boxRef} style={{ flexDirection: "row", minHeight: 1 }} onMouseDown={handleMouseDown}>
      <text fg={color}>
        {checked ? "(o) " : "( ) "}
        {focused ? <b>{children}</b> : children}
      </text>
    </box>
  )
}

export interface RadioOption {
  label: string
  value: string | number
  disabled?: boolean
}

export interface RadioGroupProps {
  /** 同 antd：选项列表（字符串数组时 label 与 value 相同） */
  options?: Array<RadioOption | string>
  /** 同 antd：受控值 */
  value?: string | number
  /** 类似 antd onChange 但参数不同：直接回传 value（antd 给的是 RadioChangeEvent） */
  tuiOnChange?: (value: string | number) => void
  /** 同 antd：整组禁用 */
  disabled?: boolean
  /** 同 antd：选项形态 */
  optionType?: "default" | "button"
  /** TUI 扩展：排列方向（默认按 optionType 推断：button 横排、default 纵排） */
  tuiDirection?: "horizontal" | "vertical"
}

function normalize(options: Array<RadioOption | string> = []): RadioOption[] {
  return options.map((o) => (typeof o === "string" ? { label: o, value: o } : o))
}

function RadioGroup({
  options,
  value,
  tuiOnChange,
  disabled = false,
  optionType = "default",
  tuiDirection,
}: RadioGroupProps) {
  const list = normalize(options)
  const isButton = optionType === "button"
  const direction = tuiDirection ?? (isButton ? "horizontal" : "vertical")
  return (
    <box
      style={{
        flexDirection: direction === "horizontal" ? "row" : "column",
        gap: direction === "horizontal" ? (isButton ? 1 : 2) : 0,
      }}
    >
      {list.map((option) => (
        <RadioBase
          key={String(option.value)}
          checked={value === option.value}
          disabled={disabled || option.disabled}
          tuiButtonStyle={isButton}
          tuiOnChange={() => tuiOnChange?.(option.value)}
        >
          {option.label}
        </RadioBase>
      ))}
    </box>
  )
}

export const Radio = Object.assign(RadioBase, { Group: RadioGroup })
