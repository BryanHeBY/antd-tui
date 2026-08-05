import { useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard, usePaste } from "@opentui/react"
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
  tuiScrollback = 1000,
  tuiPalette,
  tuiEscapeKey = DEFAULT_ESCAPE_KEY,
  tuiHotkeys,
  tuiOnTitleChange,
  tuiOnReady,
}: AntermProps) {
  const token = useToken()
  const { boxRef, width, height } = useMeasuredSize()
  const sessionRef = useRef<AntermSession | null>(null)
  const [, setFrame] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)

  const cols = width ?? 0
  const rows = height ?? 0
  const ready = cols > 0 && rows > 0

  const { focused, requestFocus, focusNext } = useFocusable({
    kind: "capture",
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
    const session = createAntermSession({
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
      session.kill()
      sessionRef.current = null
    }
    // cols/rows 变化走 resize，不重建会话
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, command, argsKey, cwd, envKey, tuiScrollback])

  useEffect(() => {
    if (ready) sessionRef.current?.resize(cols, rows)
  }, [ready, cols, rows])

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
    const session = sessionRef.current
    if (!focused || !session || key.eventType === "release") return
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
    const session = sessionRef.current
    if (!focused || !session) return
    const text = new TextDecoder().decode(event.bytes)
    session.write(encodePaste(text, session.bracketedPaste))
  })

  const forwardMouse = (event: MouseEvent, type: MouseInput["type"]) => {
    const session = sessionRef.current
    const el = boxRef.current
    if (!session || !el) return
    const col = event.x - el.x
    const row = event.y - el.y
    if (col < 0 || row < 0 || col >= cols || row >= rows) return

    if (type === "scroll" && session.mouseTracking === "none") {
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
  const defaultBg = useMemo(() => parseColor(token.colorBgContainer), [token.colorBgContainer])
  // 实例必须跨帧稳定：run 合并靠引用相等判断
  const palette = useMemo(() => toAnsiPalette(tuiPalette), [tuiPalette])

  let lines: StyledText[] = []
  if (ready && sessionRef.current) {
    lines = screenToRows(sessionRef.current.screen, {
      rows,
      scrollOffset,
      showCursor: focused,
      defaultFg,
      defaultBg,
      palette,
    })
  }

  return (
    <box
      ref={boxRef}
      onMouseDown={(event) => {
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
        backgroundColor: token.colorBgContainer,
        ...toBoxStyle(style),
      }}
    >
      {lines.map((line, index) => (
        <text key={index} attributes={0} content={line} style={{ height: 1, flexShrink: 0 }} />
      ))}
    </box>
  )
}
