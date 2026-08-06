import type { ReactNode } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { Anterm } from "@antd-tui/anterm"
import { FocusScope, truncateToWidth, useToken } from "@antd-tui/components"
import { cardTint } from "./theme"
import type { Overlay, PromotedTerminal } from "./types"

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
  const width = fullscreen ? dims.width : Math.max(40, Math.floor(dims.width * 0.85))
  const height = fullscreen ? dims.height : Math.max(6, Math.floor(dims.height * 0.8))
  const left = fullscreen ? 0 : Math.max(0, Math.floor((dims.width - width) / 2))
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
        {/* 全屏没有边框承载标题，把程序名接在提示之后；提示固定在前，长命令名被截断而非挤掉提示 */}
        <text attributes={0} fg={token.colorTextSecondary} style={{ paddingLeft: 1 }}>
          {truncateToWidth(fullscreen ? `${status} · ${title}` : status, Math.max(1, width - 2))}
        </text>
        {children}
      </box>
    </FocusScope>
  )
}

/** 全屏行为视图：只搬动 Anterm 视图，PTY 会话仍由对应的流内卡片持有。 */
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
      status={`alternate screen · Ctrl+O ${fullscreen ? "弹窗" : "全屏"}`}
    >
      <Anterm
        command={terminal.command}
        args={terminal.args}
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

/** 用户显式打开的 PTY 浮层；切换模式只改变外框，Anterm 会话保持挂载。 */
export function OverlayWindow({
  overlay,
  cwd,
  onCycle,
  onExit,
}: {
  overlay: Overlay
  cwd: string
  onCycle: () => void
  onExit: (code: number) => void
}) {
  const fullscreen = overlay.mode === "fullscreen"
  return (
    <TerminalOverlayFrame
      mode={overlay.mode}
      title={overlay.label}
      status={`Ctrl+O ${fullscreen ? "弹窗" : "全屏"} · Ctrl-D/exit 退出`}
    >
      <Anterm
        command={overlay.command}
        args={overlay.args}
        cwd={cwd}
        autoFocus
        tuiHotkeys={{ "ctrl+o": onCycle }}
        onExit={onExit}
        style={{ flexGrow: 1 }}
      />
    </TerminalOverlayFrame>
  )
}
