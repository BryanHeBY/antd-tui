import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { parseColor, type RGBA, type StyledText } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/react"
import { useToken } from "@antd-tui/components"
import {
  screenToRows,
  toAnsiPalette,
  type AntermScreen,
} from "@antd-tui/anterm"
import {
  createShellSession,
  computeRange,
  type CommandEnd,
  type CommandStart,
  type ShellDialect,
  type ShellSession,
} from "../shell"
import type { PromotedTerminal } from "../types"
import { cardTint } from "./theme"

export interface ShellSessionController {
  ready: boolean
  cwd: string
  /** 当前在飞命令：卡片据此实时派生输出 */
  running: { blockId: number; start: CommandStart | null } | null
  /** 同步的「命令在飞」标志：提交当刻即为 true，供键盘闭包立即改走 PTY */
  isBusy: () => boolean
  promoted: PromotedTerminal | null
  promotedMode: "popup" | "fullscreen"
  togglePromotedMode: () => void
  submit: (line: string, options?: { requestedOverlay?: boolean }) => void
  writeKey: ShellSession["writeKey"]
  writePaste: ShellSession["writePaste"]
  interrupt: () => void
  eof: () => void
  suspend: () => void
  runHidden: ShellSession["runHidden"] | ((script: string) => Promise<string>)
  /** 会话对象（浮层渲染 <Anterm tuiSession> 用）；未就绪为 null */
  session: ShellSession | null
  /** 运行中的活动输出：每帧调用 */
  deriveRunning: (start: CommandStart | null) => StyledText[]
}

interface Events {
  onSubmitStart: () => void
  onCwd: (cwd: string) => void
  onShellExit: (code: number | null) => void
  addShell: (label: string, cwd: string, options?: { requestedOverlay?: boolean }) => number
  closeShell: (id: number, result: { exitCode: number; lines: StyledText[]; degraded?: boolean }) => void
}

/**
 * 长驻 shell 与 React 的接缝：建会话、把 OSC 事件接进 transcript、维护 cwd 与浮层，
 * 并提供把命令输出行区间快照成 StyledText[] 的取帧器（运行中每帧、结束时一次）。
 */
export function useShellSession(opts: {
  path: string
  dialect: ShellDialect
  cwd: string
  init: "user" | "minimal"
  events: Events
}): ShellSessionController {
  const token = useToken()
  const dims = useTerminalDimensions()
  const sessionRef = useRef<ShellSession | null>(null)
  const [ready, setReady] = useState(false)
  const [cwd, setCwd] = useState(opts.cwd)
  const [running, setRunning] = useState<{ blockId: number; start: CommandStart | null } | null>(null)
  // React 状态更新在事件里是异步的，提交后紧跟的按键要立刻进 PTY，只能用 ref 同步表达
  const busyRef = useRef(false)
  const [promoted, setPromoted] = useState<PromotedTerminal | null>(null)
  const [promotedMode, setPromotedMode] = useState<"popup" | "fullscreen">("fullscreen")

  // 提交时先建卡片，onCommandStart 再把边界补给它——两者 1:1（静默命令不触发 start）
  const pendingBlock = useRef<{ blockId: number; label: string; requestedOverlay: boolean } | null>(null)
  const highWater = useRef(0)
  const latest = useRef(opts.events)
  latest.current = opts.events

  const defaultFg = useMemo(() => parseColor(token.colorText) as unknown as RGBA, [token.colorText])
  const defaultBg = useMemo(() => parseColor(cardTint.output) as unknown as RGBA, [])
  const palette = useMemo(() => toAnsiPalette(), [])

  // 把一段行区间渲染成 StyledText[]；end 为 null = 运行中活动区间
  const derive = useCallback(
    (start: CommandStart, end: CommandEnd | null): { lines: StyledText[]; degraded: boolean } => {
      const session = sessionRef.current
      if (!session) return { lines: [], degraded: false }
      const term = session.anterm
      const takeover = start.takeoverSeq !== term.screenTakeoverSeq
      const normal = term.normalScreen
      const range = computeRange({
        start: { row: start.row, col: start.col },
        end: end ? { row: end.row, col: end.col } : null,
        markRow: start.mark ? start.mark.row : start.row,
        cursorAbsoluteY: normal.cursorAbsoluteY,
        viewportY: term.screen.viewportY,
        viewportRows: term.screen.rows,
        bufferLength: normal.length,
        highWater: highWater.current,
        takeover,
      })
      highWater.current = range.highWater
      const screen: AntermScreen = range.viewport ? term.screen : normal
      // 运行中的内联命令（如嵌套 bash/zsh，不进 alternate screen）要能看到光标落在哪；
      // 冻结快照不画光标。screenToRows 用反色单元格画，不依赖宿主真光标（会被 scrollbox 裁）。
      const showCursor = end === null && term.cursorVisible
      const render = (s: AntermScreen, startY: number, rows: number) =>
        screenToRows(s, {
          rows,
          scrollOffset: 0,
          startY,
          showCursor,
          defaultFg,
          defaultBg,
          palette,
        })
      let lines = render(screen, range.startY, range.rows)
      // 末行按 D.col 截断（宽字符安全：cols 代理让 screenToRows 少读几列）
      if (range.lastCol !== undefined && lines.length > 0) {
        const clipped: AntermScreen = Object.create(screen, { cols: { get: () => range.lastCol } })
        lines[lines.length - 1] = render(clipped, range.startY + range.rows - 1, 1)[0]!
      }
      if (range.viewport) {
        while (lines.length > 0 && lines.at(-1)!.chunks.every((c) => c.text.trim() === "")) lines.pop()
      }
      return { lines, degraded: range.degraded }
    },
    [defaultBg, defaultFg, palette],
  )

  const deriveRunning = useCallback(
    (start: CommandStart | null) => (start ? derive(start, null).lines : []),
    [derive],
  )

  // 当前命令的起始边界；C 里同步写、D 里同步读（instant 命令 C/D 同批，不能靠 render 传递）
  const runningStartRef = useRef<CommandStart | null>(null)

  useEffect(() => {
    let disposed = false
    const session = createShellSession({
      path: opts.path,
      dialect: opts.dialect,
      cwd: opts.cwd,
      cols: Math.max(2, dims.width),
      rows: Math.max(2, dims.height),
      init: opts.init,
      events: {
        onReady: () => {
          if (!disposed) setReady(true)
        },
        onCommandStart: (start) => {
          if (disposed) return
          runningStartRef.current = start
          highWater.current = start.mark ? start.mark.row : start.row
          const pending = pendingBlock.current
          if (!pending) return
          setRunning({ blockId: pending.blockId, start })
          // 提升判定：显式浮层 或 已进 alternate screen
          if (pending.requestedOverlay || sessionRef.current?.anterm.alternateScreen) {
            setPromoted({
              id: pending.blockId,
              label: pending.label,
              cwd,
              session: sessionRef.current!.anterm,
            })
            setPromotedMode("fullscreen")
          }
        },
        onCommandEnd: (end) => {
          if (disposed) return
          const pending = pendingBlock.current
          const run = pending
          pendingBlock.current = null
          busyRef.current = false
          const start = runningStartRef.current
          runningStartRef.current = null
          setRunning(null)
          setPromoted(null)
          if (run) {
            const snapshot = start ? derive(start, end) : { lines: [], degraded: true }
            latest.current.closeShell(run.blockId, {
              exitCode: end.exitCode,
              lines: snapshot.lines,
              degraded: snapshot.degraded,
            })
          }
        },
        onCwd: (next) => {
          if (disposed) return
          setCwd(next)
          latest.current.onCwd(next)
        },
        onExit: (code) => {
          if (!disposed) latest.current.onShellExit(code)
        },
      },
    })
    sessionRef.current = session
    return () => {
      disposed = true
      session.kill()
      sessionRef.current = null
    }
    // 会话只建一次；尺寸变化走下面的 resize effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 浮层随 alternate screen 进出更新（promoted 只在 start 里判过一次，这里补动态进入）
  useEffect(() => {
    const session = sessionRef.current
    if (!running || !session) return
    const unsub = session.anterm.onFrame(() => {
      const alt = session.anterm.alternateScreen
      setPromoted((prev) => {
        if (alt && !prev) {
          return { id: running.blockId, label: "", cwd, session: session.anterm }
        }
        if (!alt && prev && !pendingBlock.current?.requestedOverlay) return null
        return prev
      })
    })
    return unsub
  }, [running, cwd])

  useEffect(() => {
    sessionRef.current?.requestSize(Math.max(2, dims.width), Math.max(2, dims.height))
  }, [dims.width, dims.height])

  const submit = useCallback(
    (line: string, options?: { requestedOverlay?: boolean }) => {
      const session = sessionRef.current
      if (!session) return
      const blockId = latest.current.addShell(line, cwd, { requestedOverlay: options?.requestedOverlay })
      pendingBlock.current = { blockId, label: line, requestedOverlay: options?.requestedOverlay ?? false }
      // 同步置忙并隐藏草稿，紧跟的按键（如 cat 的 stdin）立刻进 PTY
      busyRef.current = true
      setRunning({ blockId, start: null })
      latest.current.onSubmitStart()
      session.submit(line)
    },
    [cwd],
  )

  return {
    ready,
    cwd,
    running,
    isBusy: () => busyRef.current,
    promoted,
    promotedMode,
    togglePromotedMode: () => setPromotedMode((m) => (m === "popup" ? "fullscreen" : "popup")),
    submit,
    writeKey: (key) => sessionRef.current?.writeKey(key),
    writePaste: (text) => sessionRef.current?.writePaste(text),
    interrupt: () => sessionRef.current?.interrupt(),
    eof: () => sessionRef.current?.eof(),
    suspend: () => sessionRef.current?.suspend(),
    runHidden: (script: string, o?: { timeoutMs?: number }) =>
      sessionRef.current ? sessionRef.current.runHidden(script, o) : Promise.resolve(""),
    session: sessionRef.current,
    deriveRunning,
  }
}
