import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, usePaste, useTerminalDimensions } from "@opentui/react"
import { ConfigProvider, FocusScope, toBoxStyle, useToken } from "@antd-tui/components"
import { Anterm, encodeKey, encodePaste, type AntermSession } from "@antd-tui/anterm"
import { AcpClient } from "@antd-tui/acp"
import { classifyInput, DEFAULT_OVERLAY_COMMANDS } from "./triage"
import { isBuiltin, runBuiltin } from "./builtins"
import { useTranscript } from "./transcript"
import { BlockView, DraftCard, type PromotedTerminal } from "./cards"
import { cardTint } from "./theme"
import type { AnshellProps, Overlay } from "./types"
import {
  checkShellSyntax,
  commonPrefix,
  completeShellInput,
  lexShell,
  resolveShell,
  type CompletionItem,
  type SyntaxDiagnostic,
} from "./shell"

/**
 * anshell：agent 时代的对话式 shell（流式布局 + shell 行内输入）。
 *
 * 单条流式滚动：命令/终端/agent 各成卡片自上而下流动。输入是流尾「草稿卡片」的
 * 可编辑头部（Shell 为 `<cwd> $ …`，Agent 为 `<cwd> ◆ …`）。Shell 命令提交后形成流内 PTY
 * 卡片，键盘直通子进程；退出后保留最终画面并恢复空草稿。PTY 进入 alternate screen 时
 * 同一会话自动提升为弹窗（Ctrl+O 切全屏），不依赖 bash/vim 等命令名特判；自然语言交给 agent。
 * 空草稿按 Ctrl-D 或输入 exit 退出应用，运行中的 Ctrl-C/Ctrl-D 则原样交给 PTY。
 */
export function Anshell({
  cwd: initialCwd,
  shell,
  overlayCommands,
  inlineCommands,
  agentCmd,
  onQuit,
  style,
}: AnshellProps) {
  const [cwd, setCwd] = useState(initialCwd ?? process.cwd())
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [promotedTerminal, setPromotedTerminal] = useState<PromotedTerminal | null>(null)
  const [promotedMode, setPromotedMode] = useState<"popup" | "fullscreen">("popup")
  const [routeOverride, setRouteOverride] = useState<"shell" | "agent" | null>(null)
  const [diagnostic, setDiagnostic] = useState<SyntaxDiagnostic | null>(null)
  const [completions, setCompletions] = useState<CompletionItem[]>([])
  const [draftCursorVisible, setDraftCursorVisible] = useState(true)
  const transcript = useTranscript()
  const commandShell = useMemo(() => resolveShell(shell), [shell])

  const clientRef = useRef<AcpClient | null>(null)
  const quittingRef = useRef(false)
  const history = useRef<string[]>([])
  const historyPos = useRef<number>(-1)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const terminalLaunchingRef = useRef(false)
  const terminalSessionRef = useRef<AntermSession | null>(null)
  const terminalInputQueueRef = useRef<string[]>([])
  const draftCursorVisibleRef = useRef(true)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const overlaySet = useMemo(
    () => new Set(overlayCommands ?? DEFAULT_OVERLAY_COMMANDS),
    [overlayCommands],
  )
  const inlineSet = useMemo(() => new Set(inlineCommands ?? []), [inlineCommands])
  const autoTriage = useMemo(
    () => classifyInput(input, {
      which: (command) => Bun.which(command) != null,
      overlay: overlaySet,
      inline: inlineSet,
    }),
    [input, inlineSet, overlaySet],
  )
  const inputMode: "shell" | "agent" = routeOverride ?? (autoTriage.kind === "agent" ? "agent" : "shell")
  const shellLex = useMemo(() => lexShell(input), [input])

  const inlineRunning = transcript.blocks.some((b) => b.kind === "terminal" && b.state === "running")

  // OpenTUI 的原生输入光标不会被 scrollbox 的 viewport 裁剪。草稿位于内容末尾，
  // 因此只要离开底部它就已滚出视口；此时保留焦点但隐藏光标，回到底部再恢复。
  const syncDraftCursorVisibility = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.viewport.height)
    const visible = scroll.scrollTop >= maxScrollTop
    if (draftCursorVisibleRef.current === visible) return
    draftCursorVisibleRef.current = visible
    queueMicrotask(() => setDraftCursorVisible(visible))
  }, [])

  const latest = useRef({ transcript })
  latest.current = { transcript }

  const quit = useCallback(() => {
    if (quittingRef.current) return
    quittingRef.current = true
    const done = onQuit ?? (() => process.exit(0))
    const client = clientRef.current
    if (client) void client.stop().finally(done)
    else done()
  }, [onQuit])

  // 可选 agent：配置了 agentCmd 就起 ACP 客户端，走基础 prompt/stream 闭环
  useEffect(() => {
    if (!agentCmd || agentCmd.length === 0) return
    const client = new AcpClient(
      agentCmd,
      {
        onUpdate: (text) => latest.current.transcript.appendAgentChunk(text),
        onTurnEnd: () => latest.current.transcript.flushAgent(),
        onBusy: setBusy,
        onExit: () => {
          latest.current.transcript.flushAgent()
          latest.current.transcript.addNote("system", "agent 已退出")
        },
      },
      { ephemeral: true },
    )
    clientRef.current = client
    void client.start().catch((err: Error) => {
      latest.current.transcript.addNote("error", `agent 启动失败：${err.message}`)
    })
    return () => {
      void client.stop()
      clientRef.current = null
    }
  }, [agentCmd])

  // Shell 检查只负责诊断，不参与 shell/agent 分诊；输入期间防抖且丢弃过期结果。
  useEffect(() => {
    let cancelled = false
    if (inputMode !== "shell" || input.trim() === "") {
      return
    }
    const timer = setTimeout(() => {
      void checkShellSyntax(input, commandShell, cwdRef.current).then((result) => {
        if (!cancelled && result.kind !== "valid") setDiagnostic(result)
      }).catch((error: unknown) => {
        if (!cancelled) setDiagnostic({ kind: "invalid", message: `语法检查失败：${(error as Error).message}` })
      })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [input, inputMode, commandShell])

  const beginTerminalHandoff = useCallback(() => {
    terminalLaunchingRef.current = true
    terminalSessionRef.current = null
    terminalInputQueueRef.current = []
  }, [])

  const runShellCommand = useCallback((line: string) => {
    beginTerminalHandoff()
    transcript.addTerminal(commandShell, ["-lc", line], cwdRef.current, {
      label: line,
      prompt: "shell",
    })
  }, [beginTerminalHandoff, commandShell, transcript])

  const openInteractiveLine = useCallback((line: string) => {
    // 经同一个 Shell 解释原始整行，保留引号、变量、管道和 builtin；Anterm 为它提供真 PTY。
    setOverlay({ label: line, command: commandShell, args: ["-lc", line], mode: "popup" })
  }, [commandShell])

  const changeInput = useCallback((value: string) => {
    setInput(value)
    setCompletions([])
    setDiagnostic(null)
  }, [])

  const completeInput = useCallback(
    async ({ value, cursor }: { value: string; cursor: number }) => {
      // 自动模式下允许对尚未完整解析出的命令前缀补全（如 `pw<Tab>`）；
      // 只有用户显式强制到 Agent 时才彻底关闭 Shell 补全。
      if (inputMode !== "shell" && routeOverride === "agent") return
      const result = await completeShellInput(value, cursor, cwdRef.current)
      if (result.items.length === 0) {
        setCompletions([])
        return
      }
      const chars = Array.from(value)
      const current = chars.slice(result.start, result.end).join("")
      let replacement = ""
      if (result.items.length === 1) {
        const only = result.items[0]!
        replacement = `${only.value}${only.kind === "directory" ? "" : " "}`
      } else {
        const prefix = commonPrefix(result.items.map((item) => item.value))
        if (prefix.length > current.length) replacement = prefix
      }
      if (replacement !== "") {
        setCompletions([])
        return {
          value: [...chars.slice(0, result.start), replacement, ...chars.slice(result.end)].join(""),
          cursor: result.start + Array.from(replacement).length,
        }
      }
      setCompletions(result.items.slice(0, 50))
    },
    [inputMode, routeOverride],
  )

  const submitLine = useCallback(() => {
    const line = input.trim()
    const mode = inputMode
    setInput("")
    setRouteOverride(null)
    setCompletions([])
    setDiagnostic(null)
    historyPos.current = -1
    if (line === "") return
    history.current.push(line)

    if (mode === "agent") {
      transcript.addPrompt(line, cwdRef.current)
      const client = clientRef.current
      if (client) client.prompt(line)
      else transcript.addNote("system", "未配置 agent（用 ansh --agent \"<命令>\" 接入）")
      return
    }

    const argv = line.split(/\s+/).filter(Boolean)
    if (isBuiltin(argv[0] ?? "")) {
      const effect = runBuiltin(argv, cwdRef.current)
      if (effect.kind === "cd") setCwd(effect.cwd)
      else if (effect.kind === "clear") transcript.clear()
      else if (effect.kind === "exit") quit()
      else if (effect.kind === "print") transcript.addNote(effect.error ? "error" : "system", effect.text)
      return
    }

    const triage = autoTriage
    if (triage.kind === "interactive") {
      if (triage.surface === "inline") {
        beginTerminalHandoff()
        transcript.addTerminal(triage.command, triage.args, cwdRef.current)
      }
      else openInteractiveLine(line)
    } else if (triage.kind === "command") {
      runShellCommand(line)
    } else {
      // 显式切到 Shell 后，即使命令当前无法解析，也交给 Shell 给出真实错误。
      runShellCommand(line)
    }
  }, [input, inputMode, autoTriage, beginTerminalHandoff, openInteractiveLine, quit, runShellCommand, transcript])

  const submitInteractiveLine = useCallback(() => {
    const line = input.trim()
    if (line === "") return
    setInput("")
    setRouteOverride(null)
    setCompletions([])
    setDiagnostic(null)
    historyPos.current = -1
    history.current.push(line)
    openInteractiveLine(line)
  }, [input, openInteractiveLine])

  const cycleOverlayMode = useCallback(() => {
    setOverlay((o) => (o ? { ...o, mode: o.mode === "popup" ? "fullscreen" : "popup" } : o))
  }, [])

  const closeOverlay = useCallback(
    (code: number) => {
      const o = overlay
      setOverlay(null)
      if (o) transcript.addNote("system", `▶ ${o.label} (exit ${code})`)
    },
    [overlay, transcript],
  )

  const handleTerminalPromotion = useCallback((terminal: PromotedTerminal | null) => {
    if (terminal) terminalSessionRef.current = terminal.session
    setPromotedTerminal(terminal)
    if (terminal) setPromotedMode("popup")
  }, [])

  const handleTerminalSessionReady = useCallback((session: AntermSession) => {
    terminalSessionRef.current = session
    terminalLaunchingRef.current = false
    for (const bytes of terminalInputQueueRef.current) session.write(bytes)
    terminalInputQueueRef.current = []
    // 覆盖交接窗口内旧 DraftCard 可能产生的迟到 onChange。
    setInput("")
  }, [])

  const handleTerminalSessionRelease = useCallback((session: AntermSession) => {
    if (terminalSessionRef.current !== session) return
    terminalSessionRef.current = null
    terminalInputQueueRef.current = []
    terminalLaunchingRef.current = false
  }, [])

  // 流内 PTY 的整个生命周期都由这里独占转发键盘，避免卡片重排时焦点状态失真。
  useKeyboard((key) => {
    if (terminalLaunchingRef.current || terminalSessionRef.current) {
      key.preventDefault?.()
      key.stopPropagation?.()
      if (key.eventType === "release") return
      if (promotedTerminal && key.ctrl && key.name === "o") {
        setPromotedMode((value) => value === "popup" ? "fullscreen" : "popup")
        return
      }
      const session = terminalSessionRef.current
      const bytes = encodeKey(key, {
        applicationCursorKeys: session?.applicationCursorKeys ?? false,
      })
      if (bytes === null) return
      if (session) session.write(bytes)
      else terminalInputQueueRef.current.push(bytes)
      return
    }
    if (overlay || promotedTerminal || inlineRunning) return
    if (key.ctrl && key.name === "o") {
      key.preventDefault?.()
      key.stopPropagation?.()
      submitInteractiveLine()
      return
    }
    if (key.ctrl && key.name === "t") {
      key.preventDefault?.()
      key.stopPropagation?.()
      setRouteOverride(inputMode === "shell" ? "agent" : "shell")
      setCompletions([])
      setDiagnostic(null)
      return
    }
    if (key.ctrl && key.name === "d") {
      if (input === "") quit()
      return
    }
    if (key.ctrl && key.name === "c") return
    if (key.name === "up") {
      const h = history.current
      if (h.length === 0) return
      historyPos.current = historyPos.current < 0 ? h.length - 1 : Math.max(0, historyPos.current - 1)
      changeInput(h[historyPos.current] ?? "")
    } else if (key.name === "down") {
      const h = history.current
      if (historyPos.current < 0) return
      historyPos.current += 1
      if (historyPos.current >= h.length) {
        historyPos.current = -1
        changeInput("")
      } else {
        changeInput(h[historyPos.current] ?? "")
      }
    }
  })

  usePaste((event) => {
    const session = terminalSessionRef.current
    const text = new TextDecoder().decode(event.bytes)
    if (session) session.write(encodePaste(text, session.bracketedPaste))
    else if (terminalLaunchingRef.current) terminalInputQueueRef.current.push(text)
  })

  return (
    <ConfigProvider>
      <FocusScope>
        {/* 主作用域：浮层打开时挂起（输入框/内嵌终端全部失焦，键盘归浮层） */}
        <FocusScope suspended={!!overlay || !!promotedTerminal}>
          <box style={{ flexDirection: "column", width: "100%", height: "100%", ...toBoxStyle(style) }}>
            <scrollbox
              ref={scrollRef}
              style={{ flexGrow: 1 }}
              renderAfter={syncDraftCursorVisibility}
              scrollY
              scrollX={false}
              stickyScroll
              stickyStart="bottom"
              contentOptions={{ flexDirection: "column", width: "100%", minHeight: "100%", gap: 0 }}
            >
              {transcript.blocks.map((block) => (
                <BlockView
                  key={block.id}
                  block={block}
                  onTerminalExit={(id, code) => transcript.closeTerminal(id, code)}
                  onTerminalPromotion={handleTerminalPromotion}
                  onTerminalSessionReady={handleTerminalSessionReady}
                  onTerminalSessionRelease={handleTerminalSessionRelease}
                />
              ))}
              {/* PTY 退出后恢复下一条草稿；运行中键盘完全归 PTY。 */}
              {!inlineRunning && !overlay ? (
                <DraftCard
                  value={input}
                  onChange={changeInput}
                  onSubmit={submitLine}
                  cwd={cwd}
                  mode={inputMode}
                  shellTokens={shellLex.tokens}
                  diagnostic={diagnostic}
                  completions={completions}
                  onTab={completeInput}
                  cursorVisible={draftCursorVisible}
                />
              ) : null}
            </scrollbox>
          </box>
        </FocusScope>

        {overlay ? (
          <OverlayWindow overlay={overlay} cwd={cwd} onCycle={cycleOverlayMode} onExit={closeOverlay} />
        ) : promotedTerminal ? (
          <PromotedTerminalWindow
            terminal={promotedTerminal}
            mode={promotedMode}
          />
        ) : null}
      </FocusScope>
    </ConfigProvider>
  )
}

/** 全屏行为视图：只搬动 Anterm 视图，PTY 会话仍由对应的流内卡片持有。 */
function PromotedTerminalWindow({
  terminal,
  mode,
}: {
  terminal: PromotedTerminal
  mode: "popup" | "fullscreen"
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
        title={fullscreen ? undefined : terminal.label}
      >
        <text attributes={0} fg={token.colorTextSecondary} style={{ paddingLeft: 1 }}>
          {`alternate screen · Ctrl+O ${fullscreen ? "弹窗" : "全屏"}`}
        </text>
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
      </box>
    </FocusScope>
  )
}

/**
 * 用户显式打开的浮层终端：popup（居中描边）↔ fullscreen（铺满）。同一个 Anterm 固定挂载，
 * 切换只改外层 wrapper 的 style/border，因此会话保持不变。
 */
function OverlayWindow({
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
  const token = useToken()
  const dims = useTerminalDimensions()
  const label = overlay.label

  const fullscreen = overlay.mode === "fullscreen"
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
        title={fullscreen ? undefined : label}
      >
        <text attributes={0} fg={token.colorTextSecondary} style={{ paddingLeft: 1 }}>
          {`Ctrl+O ${fullscreen ? "弹窗" : "全屏"} · Ctrl-D/exit 退出`}
        </text>
        <Anterm
          command={overlay.command}
          args={overlay.args}
          cwd={cwd}
          autoFocus
          tuiHotkeys={{ "ctrl+o": onCycle }}
          onExit={onExit}
          style={{ flexGrow: 1 }}
        />
      </box>
    </FocusScope>
  )
}
