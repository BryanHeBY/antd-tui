import { type ReactNode } from "react"
import { useKeyboard } from "@opentui/react"
import { useToken } from "../theme"
import { FocusScope } from "../focus"
import { Button } from "./Button"

/**
 * 字段规范：与 antd 同名的字段行为完全一致；tui 前缀 = TUI 扩展或行为有终端适配差异。
 *
 * 终端形态：绝对定位居中浮层（无遮罩半透明，用实心背景覆盖）。
 * 内部自带 FocusScope，打开时下层作用域按键静默（焦点圈闭），Esc 关闭。
 */
export interface ModalProps {
  /** 同 antd：是否可见 */
  open?: boolean
  /** 同 antd：标题 */
  title?: ReactNode
  /** 同 antd：确认回调 */
  onOk?: () => void
  /** 同 antd：取消回调（Esc 亦触发） */
  onCancel?: () => void
  /** 同 antd：确认按钮文案 */
  okText?: string
  /** 同 antd：取消按钮文案 */
  cancelText?: string
  /** 同 antd：为 null 时不渲染底部按钮区 */
  footer?: null
  /** 类似 antd width（antd 单位为像素）：此处为终端字符列数 */
  tuiWidth?: number
  /** 类似 antd closable/keyboard：Esc 是否关闭 */
  keyboard?: boolean
  children?: ReactNode
}

export function Modal({
  open = false,
  title,
  onOk,
  onCancel,
  okText = "确定",
  cancelText = "取消",
  footer,
  tuiWidth = 50,
  keyboard = true,
  children,
}: ModalProps) {
  const token = useToken()

  if (!open) return null

  return (
    <FocusScope>
      <ModalBody
        title={title}
        onOk={onOk}
        onCancel={onCancel}
        okText={okText}
        cancelText={cancelText}
        footer={footer}
        tuiWidth={tuiWidth}
        keyboard={keyboard}
        borderColor={token.colorPrimaryHover}
        backgroundColor="#141414"
        borderStyle={token.borderStyle}
      >
        {children}
      </ModalBody>
    </FocusScope>
  )
}

interface ModalBodyProps extends Omit<ModalProps, "open"> {
  borderColor: string
  backgroundColor: string
  borderStyle: "single" | "rounded" | "double" | "heavy"
}

/** 浮层主体：拆出组件是为了让 useKeyboard 处于内层 FocusScope 之内（后挂载 → 栈顶） */
function ModalBody({
  title,
  onOk,
  onCancel,
  okText,
  cancelText,
  footer,
  tuiWidth,
  keyboard,
  borderColor,
  backgroundColor,
  borderStyle,
  children,
}: ModalBodyProps) {
  useKeyboard((key) => {
    if (keyboard && key.name === "escape") onCancel?.()
  })

  return (
    <box
      style={{
        position: "absolute",
        top: 2,
        left: 2,
        width: tuiWidth,
        zIndex: 100,
        backgroundColor,
        borderColor,
        borderStyle,
        flexDirection: "column",
        padding: 1,
        gap: 1,
      }}
      border
      title={typeof title === "string" ? title : undefined}
    >
      {title && typeof title !== "string" ? <box>{title}</box> : null}
      <box style={{ flexDirection: "column" }}>{children}</box>
      {footer === null ? null : (
        <box style={{ flexDirection: "row", gap: 2, justifyContent: "flex-end" }}>
          <Button type="primary" tuiSize="small" onClick={onOk}>
            {` ${okText} `}
          </Button>
          <Button tuiSize="small" onClick={onCancel}>
            {` ${cancelText} `}
          </Button>
        </box>
      )}
    </box>
  )
}
