import { TextAttributes } from "@opentui/core"
import type { BoxRenderable } from "@opentui/core"
import { useRef, type ReactNode } from "react"
import { useFocusable } from "../focus"
import { useToken } from "../theme"
import { toBoxStyle, type CssLikeStyle } from "../style"

type LinkType = "secondary" | "success" | "warning" | "danger"

/**
 * Typography.Link 的终端形态。
 *
 * href 会输出 OpenTUI/OSC-8 hyperlink，由支持的终端直接打开；终端没有 DOM
 * MouseEvent，因此需要回流给 $ui/agent 的点击处理使用 tuiOnClick，而不是 onClick。
 */
export interface LinkProps {
  /** 同 antd：URL（支持 OSC-8 的终端可直接打开） */
  href?: string
  /** 同 antd：禁用 */
  disabled?: boolean
  /** 同 antd：语义色 */
  type?: LinkType
  /** 同 antd：下划线；默认显示以维持链接可辨识性 */
  underline?: boolean
  /** TUI 扩展：点击或 Enter 时执行；终端没有 DOM MouseEvent 参数 */
  tuiOnClick?: () => void
  /** 同 antd（子集）：CSS 风格布局样式 */
  style?: CssLikeStyle
  children?: ReactNode
}

function colorForType(type: LinkType | undefined, disabled: boolean, token: ReturnType<typeof useToken>) {
  if (disabled) return token.colorTextDisabled
  if (type === "secondary") return token.colorTextSecondary
  if (type === "success") return token.colorSuccess
  if (type === "warning") return token.colorWarning
  if (type === "danger") return token.colorError
  return token.colorPrimaryHover
}

export function Link({ href, disabled = false, type, underline = true, tuiOnClick, style, children }: LinkProps) {
  const token = useToken()
  const boxRef = useRef<BoxRenderable | null>(null)
  const interactive = !disabled && tuiOnClick !== undefined
  const { focused, requestFocus } = useFocusable({
    kind: "action",
    disabled: !interactive,
    onActivate: tuiOnClick,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })
  const color = colorForType(type, disabled, token)

  return (
    <box
      ref={boxRef}
      style={{ minHeight: 1, ...toBoxStyle(style) }}
      onMouseDown={() => {
        if (!interactive) return
        requestFocus()
        tuiOnClick?.()
      }}
    >
      <text attributes={underline ? TextAttributes.UNDERLINE : 0} fg={focused ? token.colorPrimaryHover : color}>
        {href ? <a href={href}>{children}</a> : children}
      </text>
    </box>
  )
}
