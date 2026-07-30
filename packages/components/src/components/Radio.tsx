import { TextAttributes } from "@opentui/core"
import { useRef, type ReactNode } from "react"
import type { BoxRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"
import { toBoxStyle, type CssLikeStyle } from "../style"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 * 终端形态：(o) / ( )；optionType="button" 时渲染为连体边框按钮组。
 */

export interface RadioProps {
  /** 同 antd：受控选中态 */
  checked?: boolean
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 类似 antd onChange 但参数不同：直接回传 checked（终端无 DOM 事件对象） */
  tuiOnChange?: (checked: boolean) => void
  children?: ReactNode
}

/** Radio.Group 的内部按钮渲染参数，不构成 Radio 组件的公开属性。 */
interface RadioButtonProps extends RadioProps {
  buttonStyle?: "outline" | "solid"
  tuiDivider?: "right" | "bottom"
  tuiBlock?: boolean
}

function RadioBase({
  checked = false,
  disabled = false,
  tuiOnChange,
  buttonStyle,
  tuiDivider,
  tuiBlock = false,
  children,
}: RadioButtonProps) {
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

  if (buttonStyle) {
    // Radio.Button 的终端对应物：整组负责外框，子项只负责相邻分隔线。
    // 这保留「一组选择器」的整体感，也不会浪费 cell 在每个按钮的重复边框上。
    const solid = buttonStyle === "solid"
    const backgroundColor = disabled
      ? "transparent"
      : solid && checked
        ? token.colorPrimary
        : focused
          ? "#202020"
          : "transparent"
    const textColor = disabled
      ? token.colorTextDisabled
      : solid && checked
        ? "#ffffff"
        : focused || checked
          ? token.colorPrimaryHover
          : token.colorText
    // 不传 border 属性与传 border={false} 不完全等价：后者在 OpenTUI 的布局路径里
    // 可能保留之前的边框测量。末项必须省略属性，才能只由整组外框收口。
    const dividerBorder = tuiDivider ? { border: [tuiDivider] } : {}
    return (
      <box
        ref={boxRef}
        {...dividerBorder}
        style={{
          backgroundColor,
          minHeight: 1,
          paddingLeft: 1,
          paddingRight: 1,
          alignItems: "center",
          justifyContent: "center",
          ...(tuiBlock ? { flexGrow: 1, flexShrink: 1, flexBasis: 0 } : {}),
        }}
        onMouseDown={handleMouseDown}
      >
        <text attributes={TextAttributes.BOLD} fg={textColor} bg={backgroundColor}>
          {focused || checked ? <b>{children}</b> : children}
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
      <text attributes={TextAttributes.BOLD} fg={color}>
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
  /** 同 antd Radio.Group：按钮形态下选中项为 outline 或 solid。 */
  buttonStyle?: "outline" | "solid"
  /** 同 antd Radio.Group：按钮形态下整组占满父容器，选项等分宽/高。 */
  block?: boolean
  /** 同 antd Radio.Group：排列方向。 */
  orientation?: "horizontal" | "vertical"
  /**
   * TUI 兼容别名：早期版本已发布，保留避免打断 schema；新代码请使用 orientation。
   * 默认按 optionType 推断：button 横排、default 纵排。
   */
  tuiDirection?: "horizontal" | "vertical"
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
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
  buttonStyle = "outline",
  block = false,
  orientation,
  tuiDirection,
  style,
}: RadioGroupProps) {
  const token = useToken()
  const list = normalize(options)
  const isButton = optionType === "button"
  const direction = orientation ?? tuiDirection ?? (isButton ? "horizontal" : "vertical")
  // 保持为扁平子节点数组。OpenTUI 的原生容器需要直接拥有布局节点；把 Radio
  // 与分隔线包在 Fragment 中会让纵向模式的后半段脱离外框。
  const radios: ReactNode[] = []
  for (const [index, option] of list.entries()) {
    radios.push(
      <RadioBase
        key={String(option.value)}
        checked={value === option.value}
        disabled={disabled || option.disabled}
        buttonStyle={isButton ? buttonStyle : undefined}
        tuiDivider={
          isButton && direction === "horizontal" && index < list.length - 1 ? "right" : undefined
        }
        // 横向 block 才需要 flex 等分。纵向组本身已撑满横轴，给子项 flexGrow
        // 会在 auto-height 容器中干扰 Yoga 的内容高度测量。
        tuiBlock={isButton && block && direction === "horizontal"}
        tuiOnChange={() => tuiOnChange?.(option.value)}
      >
        {option.label}
      </RadioBase>,
    )
    if (isButton && direction === "vertical" && index < list.length - 1) {
      radios.push(
        <box
          key={`${String(option.value)}-divider`}
          border={["top"]}
          style={{
            width: "100%",
            height: 1,
            borderStyle: token.borderStyle,
            borderColor: token.colorBorder,
          }}
        />,
      )
    }
  }

  if (isButton) {
    return (
      <box
        border
        style={{
          flexDirection: direction === "horizontal" ? "row" : "column",
          borderStyle: token.borderStyle,
          borderColor: token.colorBorder,
          ...(block ? { width: "100%" as const } : {}),
          ...toBoxStyle(style),
        }}
      >
        {radios}
      </box>
    )
  }

  return (
    <box style={{ flexDirection: direction === "horizontal" ? "row" : "column", gap: direction === "horizontal" ? 2 : 0, ...toBoxStyle(style) }}>
      {radios}
    </box>
  )
}

export const Radio = Object.assign(RadioBase, { Group: RadioGroup })
