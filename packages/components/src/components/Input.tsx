import { useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { SyntaxStyle, type InputRenderable, type KeyEvent } from "@opentui/core"
import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { useFocusable } from "../focus"
import { toBoxStyle, type CssLikeStyle } from "../style"
import { TextArea, type TextAreaProps } from "./TextArea"

export type { TextAreaProps }

export interface InputHighlight {
  /** 起止位置为 Unicode code point offset，end 不包含。 */
  start: number
  end: number
  color?: string
  backgroundColor?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  dim?: boolean
}

export interface InputEdit {
  value: string
  /** 应落到的 Unicode code point offset。 */
  cursor: number
}

export interface InputTabContext {
  value: string
  cursor: number
  shift: boolean
}

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
  /** TUI 扩展：原生输入缓冲上的语义高亮范围。 */
  tuiHighlights?: InputHighlight[]
  /** TUI 扩展：是否绘制终端原生光标；隐藏时仍保留输入焦点。 */
  tuiShowCursor?: boolean
  /**
   * TUI 扩展：接管 Tab（如补全）。返回 edit 时 Input 在受控值更新后恢复光标位置；
   * 返回 void 只消费按键，适合展示候选列表。
   */
  tuiOnTab?: (context: InputTabContext) => InputEdit | void | Promise<InputEdit | void>
}

function styleKey(highlight: InputHighlight): string {
  return JSON.stringify({
    color: highlight.color,
    backgroundColor: highlight.backgroundColor,
    bold: highlight.bold,
    italic: highlight.italic,
    underline: highlight.underline,
    dim: highlight.dim,
  })
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
  tuiHighlights = [],
  tuiShowCursor = true,
  tuiOnTab,
}: InputProps) {
  const token = useToken()
  const inputRef = useRef<InputRenderable | null>(null)
  const pendingCursorRef = useRef<number | null>(null)
  const tabGenerationRef = useRef(0)
  const { focused, focusNext, requestFocus } = useFocusable({
    kind: "input",
    disabled,
    captureTab: tuiOnTab !== undefined,
  })

  const styleKeys = useMemo(
    () => [...new Set(tuiHighlights.map(styleKey))],
    [tuiHighlights],
  )
  const styleSignature = JSON.stringify(styleKeys)
  const syntaxStyle = useMemo(() => {
    if (styleKeys.length === 0) return null
    return SyntaxStyle.fromStyles(
      Object.fromEntries(
        styleKeys.map((key, index) => {
          const sample = tuiHighlights.find((highlight) => styleKey(highlight) === key)!
          return [
            `tui-input-${index}`,
            {
              fg: sample.color,
              bg: sample.backgroundColor,
              bold: sample.bold,
              italic: sample.italic,
              underline: sample.underline,
              dim: sample.dim,
            },
          ]
        }),
      ),
    )
    // styleSignature 已完整描述样式定义；范围变化不应重建 native SyntaxStyle。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleSignature])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.syntaxStyle = syntaxStyle
    input.clearAllHighlights()
    if (syntaxStyle) {
      for (const highlight of tuiHighlights) {
        const index = styleKeys.indexOf(styleKey(highlight))
        const id = syntaxStyle.getStyleId(`tui-input-${index}`)
        if (id !== null && highlight.end > highlight.start) {
          input.addHighlightByCharRange({ start: highlight.start, end: highlight.end, styleId: id })
        }
      }
    }
    if (pendingCursorRef.current !== null) {
      input.cursorOffset = pendingCursorRef.current
      pendingCursorRef.current = null
    }
  }, [value, tuiHighlights, styleKeys, syntaxStyle])

  useEffect(
    () => () => {
      syntaxStyle?.destroy()
    },
    [syntaxStyle],
  )

  // 用户继续输入或父组件改值后，丢弃仍在途的异步补全，避免旧结果覆盖新文本。
  useEffect(() => {
    tabGenerationRef.current += 1
  }, [value])

  const onKeyDown = (key: KeyEvent) => {
    if (key.name !== "tab" || !focused || disabled || !tuiOnTab) return
    key.preventDefault()
    key.stopPropagation()
    const generation = ++tabGenerationRef.current
    const currentValue = value ?? ""
    const cursor = inputRef.current?.cursorOffset ?? Array.from(currentValue).length
    void Promise.resolve(tuiOnTab({ value: currentValue, cursor, shift: key.shift })).then((edit) => {
      if (!edit || generation !== tabGenerationRef.current) return
      pendingCursorRef.current = edit.cursor
      tuiOnChange?.(edit.value)
    })
  }
  useKeyboard(onKeyDown)

  const nativeInput = (
    <input
      ref={inputRef}
      value={value ?? ""}
      maxLength={maxLength}
      placeholder={placeholder ?? ""}
      focused={focused && !disabled}
      showCursor={tuiShowCursor}
      onInput={(v: string) => tuiOnChange?.(v)}
      onSubmit={() => {
        if (tuiOnPressEnter) tuiOnPressEnter()
        else focusNext()
      }}
      width="100%"
      style={compact ? undefined : { flexGrow: 1 }}
    />
  )

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
        {nativeInput}
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
      {nativeInput}
    </box>
  )
}

/** 复合组件：对齐 antd 的 Input.TextArea */
export const Input = Object.assign(InputBase, { TextArea })
