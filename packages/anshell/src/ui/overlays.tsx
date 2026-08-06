import type { ReactNode } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { Anterm } from "@antd-tui/anterm"
import { FocusScope, truncateToWidth, useToken } from "@antd-tui/components"
import { cardTint } from "./theme"
import type { PromotedTerminal } from "../types"

type OverlayMode = "popup" | "fullscreen"

function TerminalOverlayFrame({
  mode,
  title,
  status,
  children,
}: {
  mode: OverlayMode
  title: string
  status: string
  children: ReactNode
}) {
  const token = useToken()
  const dims = useTerminalDimensions()
  const fullscreen = mode === "fullscreen"
  // 两档同宽：cols 恒定，reflow 不会发生，tuiResizeSession 才能安全 resize 共享 shell
  const width = dims.width
  const height = fullscreen ? dims.height : Math.max(6, Math.floor(dims.height * 0.8))
  const left = 0
  const top = fullscreen ? 0 : Math.max(0, Math.floor((dims.height - height) / 2))

  return (
    <FocusScope>
      <box
        style={{
          position: "absolute",
          top,
          left,
          width,
          height,
          zIndex: 100,
          backgroundColor: cardTint.overlay,
          borderColor: token.colorBorder,
          borderStyle: token.borderStyle,
          flexDirection: "column",
        }}
        border={!fullscreen}
        title={fullscreen ? undefined : title}
      >
        {/* 全屏不留 chrome：alternate screen 程序按整屏行数排版，少一行就会在底部露出空行 */}
        {fullscreen ? null : (
          <text attributes={0} fg={token.colorTextSecondary} style={{ paddingLeft: 1 }}>
            {truncateToWidth(status, Math.max(1, width - 2))}
          </text>
        )}
        {children}
      </box>
    </FocusScope>
  )
}

/** 浮层视图：只搬动 Anterm 视图，PTY 会话仍由对应的流内卡片持有。 */
export function PromotedTerminalWindow({
  terminal,
  mode,
}: {
  terminal: PromotedTerminal
  mode: OverlayMode
}) {
  const fullscreen = mode === "fullscreen"
  return (
    <TerminalOverlayFrame
      mode={mode}
      title={terminal.label}
      status={`Ctrl+O ${fullscreen ? "弹窗" : "全屏"}`}
    >
      <Anterm
        command="shell"
        cwd={terminal.cwd}
        autoFocus
        tuiSession={terminal.session}
        tuiResizeSession
        tuiKeyboardDisabled
        style={{ flexGrow: 1 }}
      />
    </TerminalOverlayFrame>
  )
}
