import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { ConfigProvider, FocusScope, toBoxStyle, useToken } from "@antd-tui/components"
import { Anterm } from "@antd-tui/anterm"
import { AcpClient } from "@antd-tui/acp"
import { classifyInput, DEFAULT_OVERLAY_COMMANDS } from "./triage"
import { runCommand, type RunningCommand } from "./command"
import { isBuiltin, runBuiltin } from "./builtins"
import { useTranscript } from "./transcript"
import { BlockView, DraftCard } from "./cards"
import { cardTint } from "./theme"
import type { AnshellProps, Overlay } from "./types"

/**
 * anshell：agent 时代的对话式 shell（流式布局 + shell 行内输入）。
 *
 * 单条流式滚动：命令/终端/agent 各成卡片自上而下流动。输入是流尾「草稿卡片」的
 * 可编辑头部（`<cwd> ❯ …`），Enter 后就地冻结成命令卡片头、输出在同卡片下方延伸
 * （所见即所得），命令跑完再现空草稿。启发式分诊：一次性命令成命令卡片；
 * bash/vim/htop 等重型终端走弹窗浮层（Ctrl+O 切全屏）；inlineCommands 内嵌流内活
 * 终端卡片；自然语言交给 agent。退出用 Ctrl-D（空输入）或 exit；Ctrl-C 中断在跑命令。
 */
export function Anshell({
  cwd: initialCwd,
  overlayCommands,
  inlineCommands,
  agentCmd,
  onQuit,
  style,
}: AnshellProps) {
  const [cwd, setCwd] = useState(initialCwd ?? process.cwd())
  const [input, setInput] = useState("")
  const [commandRunning, setCommandRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const transcript = useTranscript()

  const runningRef = useRef<RunningCommand | null>(null)
  const clientRef = useRef<AcpClient | null>(null)
  const history = useRef<string[]>([])
  const historyPos = useRef<number>(-1)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const overlaySet = useMemo(
    () => new Set(overlayCommands ?? DEFAULT_OVERLAY_COMMANDS),
    [overlayCommands],
  )
  const inlineSet = useMemo(() => new Set(inlineCommands ?? []), [inlineCommands])

  const inlineRunning = transcript.blocks.some((b) => b.kind === "terminal" && b.state === "running")

  const latest = useRef({ transcript })
  latest.current = { transcript }

  const quit = useCallback(() => {
    runningRef.current?.kill("SIGKILL")
    void clientRef.current?.stop()
    ;(onQuit ?? (() => process.exit(0)))()
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

  const runShellCommand = useCallback(
    (line: string) => {
      const id = transcript.openCommand(line, cwdRef.current)
      setCommandRunning(true)
      const cmd = runCommand({
        line,
        cwd: cwdRef.current,
        onLine: (text, stream) => latest.current.transcript.appendOutput(id, text, stream),
      })
      runningRef.current = cmd
      void cmd.exited.then((code) => {
        runningRef.current = null
        setCommandRunning(false)
        latest.current.transcript.closeCommand(id, code)
      })
    },
    [transcript],
  )

  const submitLine = useCallback(() => {
    const line = input.trim()
    setInput("")
    historyPos.current = -1
    if (line === "") return
    history.current.push(line)

    const argv = line.split(/\s+/).filter(Boolean)
    if (isBuiltin(argv[0] ?? "")) {
      const effect = runBuiltin(argv, cwdRef.current)
      if (effect.kind === "cd") setCwd(effect.cwd)
      else if (effect.kind === "clear") transcript.clear()
      else if (effect.kind === "exit") quit()
      else if (effect.kind === "print") transcript.addNote(effect.error ? "error" : "system", effect.text)
      return
    }

    const triage = classifyInput(line, {
      which: (c) => Bun.which(c) != null,
      overlay: overlaySet,
      inline: inlineSet,
    })
    if (triage.kind === "interactive") {
      if (triage.surface === "inline") transcript.addTerminal(triage.command, triage.args)
      else setOverlay({ command: triage.command, args: triage.args, mode: "popup" })
    } else if (triage.kind === "command") {
      runShellCommand(line)
    } else {
      const client = clientRef.current
      if (client) client.prompt(line)
      else transcript.addNote("system", "未配置 agent（用 ansh --agent \"<命令>\" 接入）")
    }
  }, [input, inlineSet, overlaySet, quit, runShellCommand, transcript])

  const cycleOverlayMode = useCallback(() => {
    setOverlay((o) => (o ? { ...o, mode: o.mode === "popup" ? "fullscreen" : "popup" } : o))
  }, [])

  const closeOverlay = useCallback(
    (code: number) => {
      const o = overlay
      setOverlay(null)
      if (o) transcript.addNote("system", `▶ ${o.command} (exit ${code})`)
    },
    [overlay, transcript],
  )

  // 全局键盘：仅在「对话且无浮层/无内嵌终端运行」时处理；否则把键留给终端/浮层透传
  useKeyboard((key) => {
    if (overlay || inlineRunning) return
    if (key.ctrl && key.name === "d") {
      if (input === "") quit()
      return
    }
    if (key.ctrl && key.name === "c") {
      if (runningRef.current) {
        runningRef.current.kill("SIGINT")
        transcript.addNote("system", "^C")
      }
      return
    }
    if (key.name === "up") {
      const h = history.current
      if (h.length === 0) return
      historyPos.current = historyPos.current < 0 ? h.length - 1 : Math.max(0, historyPos.current - 1)
      setInput(h[historyPos.current] ?? "")
    } else if (key.name === "down") {
      const h = history.current
      if (historyPos.current < 0) return
      historyPos.current += 1
      if (historyPos.current >= h.length) {
        historyPos.current = -1
        setInput("")
      } else {
        setInput(h[historyPos.current] ?? "")
      }
    }
  })

  return (
    <ConfigProvider>
      <FocusScope>
        {/* 主作用域：浮层打开时挂起（输入框/内嵌终端全部失焦，键盘归浮层） */}
        <FocusScope suspended={!!overlay}>
          <box style={{ flexDirection: "column", width: "100%", height: "100%", ...toBoxStyle(style) }}>
            <scrollbox
              style={{ flexGrow: 1 }}
              scrollY
              scrollX={false}
              stickyScroll
              stickyStart="bottom"
              contentOptions={{ flexDirection: "column", width: "100%", minHeight: "100%", gap: 1 }}
            >
              {transcript.blocks.map((block) => (
                <BlockView
                  key={block.id}
                  block={block}
                  cwd={cwd}
                  onTerminalExit={(id, code) => transcript.closeTerminal(id, code)}
                />
              ))}
              {/* 流尾草稿卡片：命令运行中不归位 prompt；浮层打开时键盘归浮层 */}
              {!commandRunning && !overlay ? (
                <DraftCard value={input} onChange={setInput} onSubmit={submitLine} cwd={cwd} />
              ) : null}
            </scrollbox>
          </box>
        </FocusScope>

        {overlay ? (
          <OverlayWindow overlay={overlay} cwd={cwd} onCycle={cycleOverlayMode} onExit={closeOverlay} />
        ) : null}
      </FocusScope>
    </ConfigProvider>
  )
}

/**
 * 浮层终端窗口：popup（居中描边）↔ fullscreen（铺满）。同一个 Anterm 固定挂载，
 * 切换只改外层 wrapper 的 style/border → 不 remount → bash 会话保留。
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
  const label = [overlay.command, ...overlay.args].join(" ")

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
