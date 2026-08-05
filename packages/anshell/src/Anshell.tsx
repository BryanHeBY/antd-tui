import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { ConfigProvider, FocusScope, Input, toBoxStyle, truncateToWidth, useToken } from "@antd-tui/components"
import { Anterm } from "@antd-tui/anterm"
import { AcpClient } from "@antd-tui/acp"
import { classifyInput, DEFAULT_INTERACTIVE_COMMANDS } from "./triage"
import { runCommand, type RunningCommand } from "./command"
import { isBuiltin, runBuiltin } from "./builtins"
import { useTranscript } from "./transcript"
import type { AnshellProps, ConversationEntry, ConversationKind, ShellView } from "./types"

/**
 * anshell：agent 时代的对话式 shell。
 *
 * 一个对话框接收输入，启发式分诊：像命令的直接跑（输出回显进对话），bash/vim/htop
 * 等交互式程序则压入视图栈、嵌入 anterm 全屏接管，程序结束出栈回对话框。分诊为
 * 自然语言的输入交给 agent（配置了 agentCmd 时经 ACP，否则回系统提示）。
 * 退出用 Ctrl-D（空输入）或 exit；Ctrl-C 中断在跑的命令。
 */
export function Anshell({
  cwd: initialCwd,
  interactiveCommands,
  agentCmd,
  onQuit,
  style,
}: AnshellProps) {
  const [cwd, setCwd] = useState(initialCwd ?? process.cwd())
  const [stack, setStack] = useState<ShellView[]>([{ kind: "conversation" }])
  const [input, setInput] = useState("")
  const [commandRunning, setCommandRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const transcript = useTranscript()

  const runningRef = useRef<RunningCommand | null>(null)
  const clientRef = useRef<AcpClient | null>(null)
  const history = useRef<string[]>([])
  const historyPos = useRef<number>(-1)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const top = stack[stack.length - 1]!
  const inConversation = top.kind === "conversation"

  const interactive = useMemo(
    () => new Set(interactiveCommands ?? DEFAULT_INTERACTIVE_COMMANDS),
    [interactiveCommands],
  )

  // 稳定引用：transcript 的方法与 agentCmd 供各回调闭包捕获
  const latest = useRef({ transcript, agentCmd })
  latest.current = { transcript, agentCmd }

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
        onUpdate: (text) => latest.current.transcript.appendChunk(text, "agent"),
        onTurnEnd: () => latest.current.transcript.flush(),
        onBusy: setBusy,
        onExit: () => {
          latest.current.transcript.flush()
          latest.current.transcript.appendMessage("system", "agent 已退出")
        },
      },
      { ephemeral: true },
    )
    clientRef.current = client
    void client.start().catch((err: Error) => {
      latest.current.transcript.appendMessage("error", `agent 启动失败：${err.message}`)
    })
    return () => {
      void client.stop()
      clientRef.current = null
    }
  }, [agentCmd])

  const runShellCommand = useCallback((line: string) => {
    setCommandRunning(true)
    const cmd = runCommand({
      line,
      cwd: cwdRef.current,
      onLine: (text, streamKind) =>
        latest.current.transcript.appendChunk(
          text + "\n",
          streamKind === "err" ? "command-err" : "command-out",
        ),
    })
    runningRef.current = cmd
    void cmd.exited.then((code) => {
      runningRef.current = null
      setCommandRunning(false)
      latest.current.transcript.flush()
      if (code !== 0) latest.current.transcript.appendMessage("system", `[退出码 ${code}]`)
    })
  }, [])

  const submitLine = useCallback(() => {
    const line = input.trim()
    setInput("")
    historyPos.current = -1
    if (line === "") return
    history.current.push(line)

    transcript.appendMessage("user", line)

    const argv = line.split(/\s+/).filter(Boolean)
    if (isBuiltin(argv[0] ?? "")) {
      const effect = runBuiltin(argv, cwdRef.current)
      if (effect.kind === "cd") setCwd(effect.cwd)
      else if (effect.kind === "clear") transcript.clear()
      else if (effect.kind === "exit") quit()
      else if (effect.kind === "print") transcript.appendMessage(effect.error ? "error" : "system", effect.text)
      return
    }

    const triage = classifyInput(line, { which: (c) => Bun.which(c) != null, interactive })
    if (triage.kind === "interactive") {
      setStack((prev) => [...prev, { kind: "terminal", command: triage.command, args: triage.args }])
    } else if (triage.kind === "command") {
      runShellCommand(line)
    } else {
      const client = clientRef.current
      if (client) client.prompt(line)
      else transcript.appendMessage("system", "未配置 agent（用 ansh --agent \"<命令>\" 接入）")
    }
  }, [input, interactive, quit, runShellCommand, transcript])

  const popView = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  // 全局键盘（fire 与焦点无关）：仅在对话视图处理，交互视图把键全留给 anterm 透传子进程
  useKeyboard((key) => {
    if (!inConversation) return
    if (key.ctrl && key.name === "d") {
      // 空输入的 Ctrl-D = EOF 退出（仿 bash）
      if (input === "") quit()
      return
    }
    if (key.ctrl && key.name === "c") {
      // 有命令在跑就中断它；空闲时忽略（退出请用 Ctrl-D / exit）
      if (runningRef.current) {
        runningRef.current.kill("SIGINT")
        transcript.appendMessage("system", "^C")
      }
      return
    }
    // ↑↓ 翻命令历史（Input 无方向键钩子，故在此处理）
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

  const inputActive = inConversation && !commandRunning

  return (
    <ConfigProvider>
      <FocusScope>
        <box style={{ flexDirection: "column", width: "100%", height: "100%", ...toBoxStyle(style) }}>
          <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column" }}>
            {top.kind === "terminal" ? (
              <Anterm
                command={top.command}
                args={top.args}
                cwd={cwd}
                autoFocus
                onExit={popView}
                style={{ flexGrow: 1 }}
              />
            ) : (
              <TranscriptPanel entries={transcript.entries} partial={transcript.partial} />
            )}
          </box>

          <StatusLine cwd={cwd} view={top} commandRunning={commandRunning} busy={busy} />
          <InputLine
            value={input}
            onChange={setInput}
            onSubmit={submitLine}
            active={inputActive}
          />
        </box>
      </FocusScope>
    </ConfigProvider>
  )
}

const PRESENTATION: Record<ConversationKind, { label: string; color: (t: ReturnType<typeof useToken>) => string }> = {
  user: { label: "›", color: (t) => t.colorPrimaryHover },
  "command-out": { label: " ", color: (t) => t.colorText },
  "command-err": { label: " ", color: (t) => t.colorError },
  system: { label: "·", color: (t) => t.colorTextSecondary },
  error: { label: "✗", color: (t) => t.colorError },
  agent: { label: "◆", color: (t) => t.colorWarning },
}

function ConversationLine({ entry }: { entry: ConversationEntry }) {
  const token = useToken()
  const { label, color } = PRESENTATION[entry.kind]
  const prefix = label === " " ? "" : `${label} `
  return (
    <text attributes={0} fg={color(token)}>
      {`${prefix}${entry.text}`}
    </text>
  )
}

function TranscriptPanel({
  entries,
  partial,
}: {
  entries: ConversationEntry[]
  partial: ConversationEntry | null
}) {
  const token = useToken()
  const empty = entries.length === 0 && partial === null
  return (
    <box style={{ flexGrow: 1, flexDirection: "column", paddingLeft: 1, paddingRight: 1 }}>
      <scrollbox
        style={{ flexGrow: 1 }}
        scrollY
        scrollX={false}
        stickyScroll
        stickyStart="bottom"
        contentOptions={{ flexDirection: "column" }}
      >
        {empty ? (
          <text attributes={0} fg={token.colorTextSecondary}>
            输入命令直接执行，或输入 bash/vim/htop 等进入交互程序（Ctrl-D 或 exit 退出）
          </text>
        ) : (
          <>
            {entries.map((entry, i) => (
              <ConversationLine key={i} entry={entry} />
            ))}
            {partial ? <ConversationLine entry={partial} /> : null}
          </>
        )}
      </scrollbox>
    </box>
  )
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function StatusLine({
  cwd,
  view,
  commandRunning,
  busy,
}: {
  cwd: string
  view: ShellView
  commandRunning: boolean
  busy: boolean
}) {
  const token = useToken()
  const { width } = useTerminalDimensions()
  const [tick, setTick] = useState(0)
  const active = commandRunning || busy
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setTick((v) => v + 1), 120)
    return () => clearInterval(timer)
  }, [active])

  const indicator = active ? `${SPINNER_FRAMES[tick % SPINNER_FRAMES.length]} 运行中` : "·"
  const tag =
    view.kind === "terminal"
      ? `[${view.command} · Ctrl-D/exit 退出]`
      : "[对话 · Ctrl-D/exit 退出 · ↑↓ 历史]"
  const line = truncateToWidth(`${indicator} ${cwd} ${tag}`, Math.max(1, width - 2))
  return (
    <box style={{ flexShrink: 0, height: 1, paddingLeft: 1, paddingRight: 1, overflow: "hidden" }}>
      <text attributes={0} fg={active ? token.colorPrimaryHover : token.colorTextSecondary}>
        {line}
      </text>
    </box>
  )
}

function InputLine({
  value,
  onChange,
  onSubmit,
  active,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  active: boolean
}) {
  return (
    <FocusScope suspended={!active}>
      <box style={{ flexShrink: 0, width: "100%" }}>
        <Input value={value} placeholder="输入命令或对话" tuiOnChange={onChange} tuiOnPressEnter={onSubmit} />
      </box>
    </FocusScope>
  )
}
