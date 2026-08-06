import { useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard, usePaste, useRenderer } from "@opentui/react"
import { parseColor, type MouseEvent, type StyledText } from "@opentui/core"
import {
  toBoxStyle,
  useFocusable,
  useMeasuredSize,
  useToken,
} from "@antd-tui/components"
import { createAntermSession } from "./session"
import { encodeKey, encodePaste, matchesEscapeKey, parseEscapeKey } from "./keys"
import { encodeMouse, type MouseInput } from "./mouse"
import { toAnsiPalette } from "./palette"
import { screenToRows } from "./render"
import type { AntermProps, AntermSession } from "./types"

const DEFAULT_ESCAPE_KEY = "ctrl+]"

/**
 * 内嵌一块可交互的子终端。
 *
 * 组件独占焦点期间的全部按键（`kind: "capture"`），Tab 会透传给子进程做 shell
 * 补全，因此必须靠 `tuiEscapeKey` 才能把焦点交还给页面。
 */
export function Anterm({
  command,
  args,
  cwd,
  env,
  onExit,
  style,
  autoFocus = false,
  tuiSession,
  tuiFlow = false,
  tuiFlowViewport = false,
  tuiResizeSession = false,
  tuiReadOnly = false,
  tuiKeyboardDisabled = false,
  tuiBackgroundColor,
  tuiScrollback = 1000,
  tuiPalette,
  tuiEscapeKey = DEFAULT_ESCAPE_KEY,
  tuiHotkeys,
  tuiOnTitleChange,
  tuiOnReady,
}: AntermProps) {
  const token = useToken()
  const renderer = useRenderer()
  const { boxRef, width, height } = useMeasuredSize()
  const sessionRef = useRef<AntermSession | null>(null)
  const ownsHostCursor = useRef(false)
  const [, setFrame] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)

  const cols = width ?? 0
  const rows = height ?? 0
  const ready = cols > 0 && rows > 0

  const { focused, requestFocus, focusNext } = useFocusable({
    kind: "capture",
    disabled: tuiReadOnly,
    getRect: () => {
      const el = boxRef.current
      return el ? { x: el.x, y: el.y, width: el.width, height: el.height } : null
    },
  })

  const latest = useRef({ onExit, tuiOnTitleChange, tuiOnReady })
  latest.current = { onExit, tuiOnTitleChange, tuiOnReady }

  const argsKey = JSON.stringify(args ?? [])
  const envKey = JSON.stringify(env ?? {})

  // 首帧尺寸未知，等测量结果出来再建会话，避免用 80×24 起进程后立刻 resize
  useEffect(() => {
    if (!ready) return
    const owned = tuiSession === undefined
    const session = tuiSession ?? createAntermSession({
      command,
      args,
      cwd,
      env,
      cols,
      rows,
      scrollback: tuiScrollback,
      onExit: (code) => latest.current.onExit?.(code),
      onTitleChange: (title) => latest.current.tuiOnTitleChange?.(title),
    })
    sessionRef.current = session
    latest.current.tuiOnReady?.({
      write: (data) => session.write(data),
      kill: () => session.kill(),
    })
    const unsubscribe = session.onFrame(() => setFrame((v) => v + 1))
    return () => {
      unsubscribe()
      if (owned) session.kill()
      if (sessionRef.current === session) sessionRef.current = null
    }
    // cols/rows 变化走 resize，不重建会话
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, command, argsKey, cwd, envKey, tuiScrollback, tuiSession])

  useEffect(() => {
    if (ready && (tuiSession === undefined || tuiResizeSession)) sessionRef.current?.resize(cols, rows)
  }, [ready, cols, rows, tuiSession, tuiResizeSession])

  useEffect(() => {
    if (autoFocus) requestFocus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus])

  const escapeSpec = useMemo(() => parseEscapeKey(tuiEscapeKey), [tuiEscapeKey])
  const hotkeys = useMemo(
    () =>
      Object.entries(tuiHotkeys ?? {}).map(([key, cb]) => ({ spec: parseEscapeKey(key), cb })),
    [tuiHotkeys],
  )

  useKeyboard((key) => {
    const session = tuiSession ?? sessionRef.current
    if (tuiKeyboardDisabled || !focused || !session || key.eventType === "release") return
    if (matchesEscapeKey(key, escapeSpec)) {
      focusNext()
      return
    }
    // 宿主热键：命中则拦截，不透传子进程
    for (const { spec, cb } of hotkeys) {
      if (matchesEscapeKey(key, spec)) {
        cb()
        return
      }
    }
    const bytes = encodeKey(key, { applicationCursorKeys: session.applicationCursorKeys })
    if (bytes === null) return
    // 有输入即视为回到实时视图
    if (scrollOffset !== 0) {
      setScrollOffset(0)
      session.scrollToBottom()
    }
    session.write(bytes)
  })

  usePaste((event) => {
    const session = tuiSession ?? sessionRef.current
    if (tuiKeyboardDisabled || !focused || !session) return
    const text = new TextDecoder().decode(event.bytes)
    session.write(encodePaste(text, session.bracketedPaste))
  })

  const forwardMouse = (event: MouseEvent, type: MouseInput["type"]) => {
    const session = tuiSession ?? sessionRef.current
    const el = boxRef.current
    if (!session || !el) return
    const col = event.x - el.x
    const row = event.y - el.y
    if (col < 0 || row < 0 || col >= cols || row >= rows) return

    if (type === "scroll" && session.mouseTracking === "none") {
      // flow 视图已经平铺进宿主列表，滚轮应继续交给外层 scrollbox。
      if (tuiFlow) return
      // 子进程没要鼠标上报时，滚轮用来翻本组件的回看缓冲
      const delta = event.scroll?.direction === "up" ? -3 : 3
      session.scrollLines(delta)
      setScrollOffset((prev) => Math.max(0, prev - delta))
      return
    }

    const bytes = encodeMouse(
      {
        type,
        button: event.button,
        col,
        row,
        modifiers: event.modifiers,
        scroll: event.scroll,
      },
      session.mouseTracking,
      session.sgrMouse,
    )
    if (bytes !== null) session.write(bytes)
  }

  const defaultFg = useMemo(() => parseColor(token.colorText), [token.colorText])
  const defaultBg = useMemo(
    () => parseColor(tuiBackgroundColor ?? token.colorBgContainer),
    [tuiBackgroundColor, token.colorBgContainer],
  )
  // 实例必须跨帧稳定：run 合并靠引用相等判断
  const palette = useMemo(() => toAnsiPalette(tuiPalette), [tuiPalette])

  let lines: StyledText[] = []
  const renderSession = tuiSession ?? sessionRef.current
  const flowViewport = tuiFlowViewport || !!(tuiFlow && renderSession?.screenTakeover)
  const renderScreen = renderSession
    ? (tuiFlow && !flowViewport ? renderSession.normalScreen : renderSession.screen)
    : null
  let renderedRows = tuiFlow && renderSession
    ? flowViewport
      ? renderScreen!.rows
      : (renderSession.exited ? renderSession.normalOutputRows : renderSession.normalContentRows)
    : rows
  const showCursor = !!renderScreen && !!renderSession?.cursorVisible && !renderSession.exited && (
    tuiFlow ? !tuiReadOnly : focused && scrollOffset === 0
  )
  // 视口模式（浮层/全屏）把光标交给宿主终端的真光标：它自带闪烁与用户的光标样式，
  // 也不会像涂色单元格那样在子程序重画后残留成白块。flow 卡片仍用涂色光标——真光标
  // 不受 scrollbox 视口裁剪，卡片滚出屏幕后会飘在别处。
  const hostCursor = !tuiFlow
  const cursorWindowRow = renderScreen
    ? renderScreen.cursorAbsoluteY - (renderScreen.viewportY - scrollOffset)
    : -1
  const cursorWindowCol = renderScreen ? renderScreen.cursorX : -1
  if (ready && renderSession) {
    lines = screenToRows(renderScreen!, {
      rows: renderedRows,
      scrollOffset,
      startY: tuiFlow ? (flowViewport ? renderScreen!.viewportY : 0) : undefined,
      // 光标与当前行一同生成，旧位置会随下一帧恢复；不能用绝对定位的实体字符叠加，
      // 否则高频 shell 重绘时 OpenTUI 可能来不及擦除旧节点而留下块状残影。
      showCursor: showCursor && !hostCursor,
      defaultFg,
      defaultBg,
      palette,
    })
    if (flowViewport) {
      while (lines.length > 0 && lines.at(-1)!.chunks.every((chunk) => chunk.text.trim() === "")) {
        lines.pop()
      }
      renderedRows = lines.length
    }
  }

  const hostCursorVisible =
    hostCursor &&
    showCursor &&
    cursorWindowRow >= 0 &&
    cursorWindowRow < renderedRows &&
    cursorWindowCol >= 0 &&
    cursorWindowCol < cols
  useEffect(() => {
    const el = boxRef.current
    if (hostCursorVisible && el) {
      ownsHostCursor.current = true
      // setCursorPosition 是 1-based
      renderer.setCursorPosition(el.x + cursorWindowCol + 1, el.y + cursorWindowRow + 1, true)
    } else if (ownsHostCursor.current) {
      ownsHostCursor.current = false
      renderer.setCursorPosition(0, 0, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, hostCursorVisible, cursorWindowCol, cursorWindowRow])

  useEffect(
    () => () => {
      if (!ownsHostCursor.current) return
      ownsHostCursor.current = false
      renderer.setCursorPosition(0, 0, false)
    },
    [renderer],
  )

  return (
    <box
      ref={boxRef}
      onMouseDown={(event) => {
        if (tuiReadOnly) return
        requestFocus()
        forwardMouse(event, "down")
      }}
      onMouseUp={(event) => forwardMouse(event, "up")}
      onMouseMove={(event) => forwardMouse(event, "move")}
      onMouseDrag={(event) => forwardMouse(event, "drag")}
      onMouseScroll={(event) => forwardMouse(event, "scroll")}
      style={{
        flexGrow: 1,
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: tuiBackgroundColor ?? token.colorBgContainer,
        ...toBoxStyle(style),
        ...(tuiFlow ? { height: renderedRows, flexGrow: 0, flexShrink: 0 } : null),
      }}
    >
      {lines.map((line, index) => (
        // 一整行作为单个 StyledText 原子更新。终端整屏重画时 run 的数量和边界会
        // 大幅变化；拆成 React span 会复用错旧节点，导致已经移动的反色背景残留。
        <text
          key={index}
          attributes={0}
          content={line}
          style={{ height: 1, flexShrink: 0 }}
        />
      ))}
    </box>
  )
}
