import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, usePaste } from "@opentui/react"
import { ConfigProvider, FocusScope, toBoxStyle } from "@antd-tui/components"
import type { AntermSession } from "@antd-tui/anterm"
import { AcpClient, type AvailableCommand, type SessionConfigOption, type SessionModeState } from "@antd-tui/acp"
import { classifyInput, DEFAULT_OVERLAY_COMMANDS } from "./triage"
import { isBuiltin, runBuiltin } from "./builtins"
import { useTranscript } from "./transcript"
import { AgentBusyLine, BlockView, DraftCard } from "./cards"
import { TerminalInputHandoff } from "./terminal-input"
import { draftReducer, initialDraftState } from "./draft-state"
import { PromotedTerminalWindow } from "./overlays"
import {
  compileAgentCommand,
  findModelOption,
  listCommands,
  matchCommands,
  parseSlash,
  SLASH_MENU_LIMIT,
  type SlashContext,
} from "./commands"
import { outcomeOfKind, PermissionPolicy } from "./permissions"
import { toolLines } from "./tool-content"
import type { AnshellProps, PromotedTerminal } from "./types"
import {
  checkShellSyntax,
  commonPrefix,
  completeShellInput,
  lexShell,
  resolveShell,
} from "./shell"

/**
 * anshell：agent 时代的对话式 shell（流式布局 + shell 行内输入）。
 *
 * 单条流式滚动：命令/终端/agent 各成卡片自上而下流动。输入是流尾「草稿卡片」的
 * 可编辑头部（Shell 为 `<cwd> $ …`，Agent 为 `<cwd> ◆ …`）。Shell 命令提交后形成流内 PTY
 * 卡片，键盘直通子进程；退出后保留最终画面并恢复空草稿。PTY 进入 alternate screen 时
 * 同一会话自动提升为弹窗（Ctrl+O 切全屏），不依赖 bash/vim 等命令名特判；自然语言交给 agent。
 * 草稿中的 Ctrl-C 取消当前输入，空草稿按 Ctrl-D 或输入 exit 退出应用；运行中的
 * Ctrl-C/Ctrl-D 则原样交给 PTY。
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
  const [draft, dispatchDraft] = useReducer(draftReducer, initialDraftState)
  const { input, routeOverride, diagnostic, completions, menuOpen, menuIndex } = draft
  const [promotedTerminal, setPromotedTerminal] = useState<PromotedTerminal | null>(null)
  const [promotedMode, setPromotedMode] = useState<"popup" | "fullscreen">("fullscreen")
  const [draftCursorVisible, setDraftCursorVisible] = useState(true)
  const [agentReady, setAgentReady] = useState(false)
  const [agentCommands, setAgentCommands] = useState<AvailableCommand[]>([])
  const [agentModes, setAgentModes] = useState<SessionModeState | null>(null)
  const [agentConfig, setAgentConfig] = useState<SessionConfigOption[]>([])
  const [agentUsage, setAgentUsage] = useState<string | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const transcript = useTranscript()
  const commandShell = useMemo(() => resolveShell(shell), [shell])

  const clientRef = useRef<AcpClient | null>(null)
  const quittingRef = useRef(false)
  const history = useRef<string[]>([])
  const historyPos = useRef<number>(-1)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const terminalInput = useMemo(() => new TerminalInputHandoff(), [])
  const policy = useMemo(() => new PermissionPolicy(), [])
  // 待人工决策的权限：卡片按数字键选完后经 resolve 回给 agent
  const pendingPermission = useRef<{
    blockId: number
    tool: string
    options: Array<{ optionId: string; name: string; kind: string }>
    resolve: (decision: { outcome: "selected"; optionId: string } | { outcome: "cancelled" }) => void
  } | null>(null)
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
  const slash = useMemo(() => parseSlash(input), [input])
  const slashContext = useMemo<SlashContext>(
    () => ({
      agentReady,
      support: clientRef.current?.support ?? null,
      modes: agentModes,
      configOptions: agentConfig,
      agentCommands,
    }),
    [agentReady, agentModes, agentConfig, agentCommands],
  )
  const slashMenu = useMemo(
    () => (menuOpen ? matchCommands(input, slashContext) : []),
    [menuOpen, input, slashContext],
  )
  // 斜杠优先于 shell/agent 分诊：/session 不能被当成找不到的命令丢给 agent
  const inputMode: "shell" | "agent" | "command" = slash
    ? "command"
    : (routeOverride ?? (autoTriage.kind === "agent" ? "agent" : "shell"))
  const shellLex = useMemo(() => lexShell(input), [input])

  const inlineRunning = transcript.blocks.some((b) => b.kind === "terminal" && b.state === "running")
  const permissionPending = transcript.blocks.some((b) => b.kind === "permission" && b.state === "pending")

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

  const latest = useRef({ transcript, slashContext, agentUsage })
  latest.current = { transcript, slashContext, agentUsage }

  const quit = useCallback(() => {
    if (quittingRef.current) return
    quittingRef.current = true
    const done = onQuit ?? (() => process.exit(0))
    const client = clientRef.current
    if (client) void client.stop().finally(done)
    else done()
  }, [onQuit])

  /**
   * session/request_permission 的宿主决策：先查记忆策略（allow_always/reject_always），
   * 命中就自动回并留一张已决策卡片；否则开一张待决策卡片，等用户按数字键。
   */
  const decidePermission = useCallback(
    (request: {
      title?: string
      options: Array<{ optionId: string; name: string; kind: string }>
    }) => {
      const t = latest.current.transcript
      const tool = request.title ?? "工具调用"
      const options = request.options
      const remembered = policy.lookup(tool, options)
      if (remembered) {
        const option = options.find((o) => o.optionId === remembered.optionId)!
        const id = t.addPermission({ toolCallId: tool, title: tool, options })
        policy.record(tool, option, outcomeOfKind(option.kind), true)
        t.resolvePermission(id, option.name, true)
        return Promise.resolve({ outcome: "selected" as const, optionId: option.optionId })
      }
      if (options.length === 0) {
        policy.record(tool, null, "cancelled", true)
        return Promise.resolve({ outcome: "cancelled" as const })
      }
      const blockId = t.addPermission({ toolCallId: tool, title: tool, options })
      return new Promise<{ outcome: "selected"; optionId: string } | { outcome: "cancelled" }>((resolve) => {
        pendingPermission.current = { blockId, tool, options, resolve }
      })
    },
    [policy],
  )

  // 可选 agent：配置了 agentCmd 就起 ACP 客户端，session/update 的各变体分别落成卡片
  useEffect(() => {
    if (!agentCmd || agentCmd.length === 0) return
    const client = new AcpClient(
      agentCmd,
      {
        onUpdate: (text) => latest.current.transcript.appendAgentChunk(text),
        onTurnEnd: () => latest.current.transcript.flushAgent(),
        onToolCall: (call) => {
          latest.current.transcript.flushAgent()
          latest.current.transcript.upsertTool({
            toolCallId: call.toolCallId,
            title: call.title ?? undefined,
            toolKind: call.kind ?? undefined,
            status: call.status ?? undefined,
            lines: call.content ? toolLines(call.content) : undefined,
          })
        },
        onCommands: (commands) => setAgentCommands(commands),
        onMode: (modeId) => {
          setAgentModes((prev) => (prev ? { ...prev, currentModeId: modeId } : prev))
          latest.current.transcript.addNote("system", `agent 模式切换为 ${modeId}`)
        },
        onConfigOptions: (options) => setAgentConfig(options),
        onUsage: (usage) => {
          const cost = usage.cost ? `  ${usage.cost.amount} ${usage.cost.currency}` : ""
          setAgentUsage(`${usage.used}/${usage.size}${cost}`)
        },
        onBusy: setAgentBusy,
        onPermission: decidePermission,
        onExit: (code) => {
          latest.current.transcript.flushAgent()
          setAgentReady(false)
          setAgentBusy(false)
          latest.current.transcript.addNote("system", `agent 已退出（code ${code ?? "?"}）`)
        },
      },
      { ephemeral: true, cwd: cwdRef.current },
    )
    clientRef.current = client
    void client
      .start()
      .then(() => {
        setAgentReady(true)
        setAgentModes(client.modes)
        setAgentConfig(client.configOptions)
        setAgentCommands(client.availableCommands)
      })
      .catch((err: Error) => {
        latest.current.transcript.addNote("error", `agent 启动失败：${err.message}`)
      })
    return () => {
      void client.stop()
      clientRef.current = null
      setAgentReady(false)
    }
  }, [agentCmd, decidePermission])

  // Shell 检查只负责诊断，不参与 shell/agent 分诊；输入期间防抖且丢弃过期结果。
  useEffect(() => {
    let cancelled = false
    if (inputMode !== "shell" || input.trim() === "") {
      return
    }
    const timer = setTimeout(() => {
      void checkShellSyntax(input, commandShell, cwdRef.current).then((result) => {
        if (!cancelled && result.kind !== "valid") dispatchDraft({ type: "diagnostic", diagnostic: result })
      }).catch((error: unknown) => {
        if (!cancelled) dispatchDraft({
          type: "diagnostic",
          diagnostic: { kind: "invalid", message: `语法检查失败：${(error as Error).message}` },
        })
      })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [input, inputMode, commandShell])

  const beginTerminalHandoff = useCallback(() => {
    terminalInput.begin()
  }, [terminalInput])

  const runShellCommand = useCallback((line: string) => {
    beginTerminalHandoff()
    transcript.addTerminal(commandShell, ["-lc", line], cwdRef.current, {
      label: line,
      prompt: "shell",
    })
  }, [beginTerminalHandoff, commandShell, transcript])

  const openInteractiveLine = useCallback((line: string) => {
    // 经同一个 Shell 解释原始整行，保留引号、变量、管道和 builtin；与普通命令共用流内
    // PTY 卡片，只是立刻提升为浮层——退出后自然留在列表里，样式与其他卡片一致。
    beginTerminalHandoff()
    transcript.addTerminal(commandShell, ["-lc", line], cwdRef.current, {
      label: line,
      prompt: "shell",
      fullscreen: true,
    })
  }, [beginTerminalHandoff, commandShell, transcript])

  const changeInput = useCallback((value: string) => {
    dispatchDraft({ type: "change", input: value })
  }, [])

  const cancelDraft = useCallback(() => {
    dispatchDraft({ type: "reset" })
    historyPos.current = -1
  }, [])

  const completeInput = useCallback(
    async ({ value, cursor }: { value: string; cursor: number }) => {
      // 自动模式下允许对尚未完整解析出的命令前缀补全（如 `pw<Tab>`）；
      // 只有用户显式强制到 Agent 时才彻底关闭 Shell 补全。
      if (inputMode !== "shell" && routeOverride === "agent") return
      const result = await completeShellInput(value, cursor, cwdRef.current)
      if (result.items.length === 0) {
        dispatchDraft({ type: "completions", completions: [] })
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
        dispatchDraft({ type: "completions", completions: [] })
        return {
          value: [...chars.slice(0, result.start), replacement, ...chars.slice(result.end)].join(""),
          cursor: result.start + Array.from(replacement).length,
        }
      }
      dispatchDraft({ type: "completions", completions: result.items.slice(0, 50) })
    },
    [inputMode, routeOverride],
  )

  /**
   * 斜杠命令执行：本地命令映射到真正的 ACP 方法（会话/模式/模型/取消/用量/权限），
   * 其余名字按 agent 命令处理——ACP 没有 execute 方法，命令就是一段约定 prompt 文本。
   */
  const runSlashCommand = useCallback(
    (name: string, rest: string) => {
      const t = latest.current.transcript
      const cwd = cwdRef.current
      const client = clientRef.current
      const requireAgent = (): boolean => {
        if (client) return true
        t.addCommand(name, rest, cwd, ["未配置 agent（用 ansh --agent \"<命令>\" 接入）"])
        return false
      }
      const fail = (id: number) => (err: Error) => t.setCommandLines(id, [`失败：${err.message}`])

      switch (name) {
        case "help": {
          const lines = listCommands(latest.current.slashContext).map(
            (command) =>
              `/${command.name}${command.hint ? ` ${command.hint}` : ""}  ${command.description}` +
              (command.source === "agent" ? "  · agent" : ""),
          )
          t.addCommand(name, rest, cwd, lines)
          return
        }
        case "session": {
          if (!requireAgent()) return
          const [verb, arg] = rest.split(/\s+/).filter(Boolean)
          const id = t.addCommand(name, rest, cwd, ["…"])
          if (verb === undefined) {
            void client!
              .listSessions()
              .then((sessions) =>
                t.setCommandLines(id, [
                  `当前会话 ${client!.sessionId ?? "—"}`,
                  ...sessions.map(
                    (session) =>
                      `${session.sessionId === client!.sessionId ? "▸" : " "} ${session.sessionId}` +
                      `${session.updatedAt ? `  ${session.updatedAt}` : ""}` +
                      `${session.title ? `  ${session.title}` : ""}`,
                  ),
                  ...(sessions.length === 0 ? ["（agent 未返回会话列表）"] : []),
                ]),
              )
              .catch(fail(id))
            return
          }
          if (verb === "new") {
            void client!
              .newSession()
              .then((sessionId) => {
                setAgentCommands(client!.availableCommands)
                setAgentModes(client!.modes)
                setAgentConfig(client!.configOptions)
                t.setCommandLines(id, [`已新建会话 ${sessionId}`])
              })
              .catch(fail(id))
            return
          }
          if (verb === "load" && arg) {
            void client!
              .loadSession(arg)
              .then(() => {
                setAgentModes(client!.modes)
                setAgentConfig(client!.configOptions)
                t.setCommandLines(id, [`已切换到会话 ${arg}（历史经 session/update 回放）`])
              })
              .catch(fail(id))
            return
          }
          if (verb === "delete" && arg) {
            void client!
              .deleteSession(arg)
              .then(() => t.setCommandLines(id, [`已删除会话 ${arg}`]))
              .catch(fail(id))
            return
          }
          t.setCommandLines(id, ["用法：/session [new | load <id> | delete <id>]"])
          return
        }
        case "mode": {
          if (!requireAgent()) return
          const modes = client!.modes
          if (!modes) {
            t.addCommand(name, rest, cwd, ["该 agent 未声明会话模式"])
            return
          }
          if (rest === "") {
            t.addCommand(
              name,
              rest,
              cwd,
              modes.availableModes.map(
                (mode) =>
                  `${mode.id === modes.currentModeId ? "▸" : " "} ${mode.id}` +
                  `${mode.name === mode.id ? "" : `  ${mode.name}`}` +
                  `${mode.description ? `  ${mode.description}` : ""}`,
              ),
            )
            return
          }
          const id = t.addCommand(name, rest, cwd, ["…"])
          void client!
            .setMode(rest)
            .then(() => {
              setAgentModes(client!.modes)
              t.setCommandLines(id, [`已切到模式 ${rest}`])
            })
            .catch(fail(id))
          return
        }
        case "model": {
          if (!requireAgent()) return
          const option = findModelOption(client!.configOptions)
          if (!option || option.type !== "select") {
            t.addCommand(name, rest, cwd, ["该 agent 未提供模型配置项"])
            return
          }
          const choices = option.options.flatMap((entry) =>
            "group" in entry ? entry.options : [entry],
          )
          if (rest === "") {
            t.addCommand(
              name,
              rest,
              cwd,
              choices.map(
                (choice) =>
                  `${choice.value === option.currentValue ? "▸" : " "} ${choice.value}  ${choice.name}`,
              ),
            )
            return
          }
          const id = t.addCommand(name, rest, cwd, ["…"])
          void client!
            .setConfigOption(option.id, rest)
            .then((options) => {
              setAgentConfig(options)
              t.setCommandLines(id, [`已切到 ${rest}`])
            })
            .catch(fail(id))
          return
        }
        case "cancel": {
          if (!requireAgent()) return
          client!.cancel()
          t.addCommand(name, rest, cwd, ["已发送 session/cancel"])
          return
        }
        case "usage": {
          if (!requireAgent()) return
          t.addCommand(name, rest, cwd, [latest.current.agentUsage ?? "agent 未上报 usage"])
          return
        }
        case "permissions": {
          if (rest === "reset") {
            const count = policy.forget()
            t.addCommand(name, rest, cwd, [`已清空 ${count} 条权限记忆（审计流水保留）`])
            return
          }
          const memory = [...policy.memory.entries()].map(
            ([tool, decision]) => `记忆  ${tool} → ${decision.option}（${decision.kind}）`,
          )
          const records = policy.records.map(
            (record) =>
              `#${record.seq}  ${record.tool} → ${record.option}` +
              `  ${record.outcome}${record.auto ? "（记忆）" : ""}`,
          )
          const lines = [...memory, ...records]
          t.addCommand(name, rest, cwd, lines.length > 0 ? lines : ["暂无权限记录"])
          return
        }
        default: {
          if (!requireAgent()) return
          t.addCommand(name, rest, cwd, ["已交给 agent"])
          client!.prompt(compileAgentCommand(name, rest))
        }
      }
    },
    [policy],
  )

  /**
   * Enter 落在斜杠菜单上：需要参数的命令先补全命令名等参数，否则直接执行选中项。
   */
  const acceptMenu = useCallback((): boolean => {
    const item = slashMenu[menuIndex]
    if (!item) return false
    const rest = slash?.rest ?? ""
    // 命令名还没敲全且该命令带参数提示：先补全名字等参数。名字已完整就直接执行——
    // /session、/mode、/model 这些不带参数时就是「列出」。
    if (item.hint && rest === "" && slash?.name !== item.name) {
      dispatchDraft({ type: "change", input: `/${item.name} ` })
      return true
    }
    dispatchDraft({ type: "reset" })
    historyPos.current = -1
    history.current.push(`/${item.name}${rest === "" ? "" : ` ${rest}`}`)
    runSlashCommand(item.name, rest)
    return true
  }, [menuIndex, runSlashCommand, slash, slashMenu])

  const submitLine = useCallback(() => {
    if (menuOpen && slashMenu.length > 0 && acceptMenu()) return
    const line = input.trim()
    const mode = inputMode
    dispatchDraft({ type: "reset" })
    historyPos.current = -1
    if (line === "") return
    history.current.push(line)

    if (mode === "command") {
      const parsed = parseSlash(line)
      if (parsed) {
        runSlashCommand(parsed.name, parsed.rest)
        return
      }
    }

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
  }, [
    acceptMenu,
    autoTriage,
    beginTerminalHandoff,
    input,
    inputMode,
    menuOpen,
    openInteractiveLine,
    quit,
    runShellCommand,
    runSlashCommand,
    slashMenu,
    transcript,
  ])

  const submitInteractiveLine = useCallback(() => {
    const line = input.trim()
    if (line === "") return
    dispatchDraft({ type: "reset" })
    historyPos.current = -1
    history.current.push(line)
    openInteractiveLine(line)
  }, [input, openInteractiveLine])

  const handleTerminalPromotion = useCallback((terminal: PromotedTerminal | null) => {
    setPromotedTerminal(terminal)
    if (terminal) setPromotedMode("fullscreen")
  }, [])

  const handleTerminalSessionReady = useCallback((session: AntermSession) => {
    terminalInput.attach(session)
    // 覆盖交接窗口内旧 DraftCard 可能产生的迟到 onChange。
    dispatchDraft({ type: "change", input: "" })
  }, [terminalInput])

  const handleTerminalSessionRelease = useCallback((session: AntermSession) => {
    terminalInput.release(session)
  }, [terminalInput])

  // 流内 PTY 的整个生命周期都由这里独占转发键盘，避免卡片重排时焦点状态失真。
  useKeyboard((key) => {
    if (terminalInput.active) {
      key.preventDefault?.()
      key.stopPropagation?.()
      if (key.eventType === "release") return
      if (promotedTerminal && key.ctrl && key.name === "o") {
        setPromotedMode((value) => value === "popup" ? "fullscreen" : "popup")
        return
      }
      terminalInput.writeKey(key)
      return
    }
    if (promotedTerminal || inlineRunning) return

    // 权限卡片待决策时草稿不渲染，键盘完全归它：数字键选项，Esc/Ctrl-C 取消
    const pending = pendingPermission.current
    if (pending) {
      key.preventDefault?.()
      key.stopPropagation?.()
      const digit = /^[1-9]$/.test(key.name ?? "") ? Number(key.name) : null
      if (digit !== null && digit <= pending.options.length) {
        const option = pending.options[digit - 1]!
        policy.record(pending.tool, option, outcomeOfKind(option.kind), false)
        transcript.resolvePermission(pending.blockId, option.name, false)
        pendingPermission.current = null
        pending.resolve({ outcome: "selected", optionId: option.optionId })
        return
      }
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        policy.record(pending.tool, null, "cancelled", false)
        transcript.resolvePermission(pending.blockId, "已取消", false)
        pendingPermission.current = null
        pending.resolve({ outcome: "cancelled" })
      }
      return
    }

    // agent 轮次在途：草稿此时不渲染，Esc/Ctrl-C 直接中断（等价 /cancel）
    if (agentBusy) {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        key.preventDefault?.()
        key.stopPropagation?.()
        clientRef.current?.cancel()
      }
      return
    }

    // 斜杠菜单的方向键/Esc 必须抢在命令历史翻阅之前
    if (menuOpen && slashMenu.length > 0) {
      if (key.name === "up" || key.name === "down") {
        key.preventDefault?.()
        key.stopPropagation?.()
        dispatchDraft({
          type: "menuMove",
          delta: key.name === "down" ? 1 : -1,
          count: Math.min(slashMenu.length, SLASH_MENU_LIMIT),
        })
        return
      }
      if (key.name === "escape") {
        key.preventDefault?.()
        key.stopPropagation?.()
        dispatchDraft({ type: "menuClose" })
        return
      }
    }

    if (key.ctrl && key.name === "o") {
      key.preventDefault?.()
      key.stopPropagation?.()
      submitInteractiveLine()
      return
    }
    if (key.ctrl && key.name === "t") {
      key.preventDefault?.()
      key.stopPropagation?.()
      dispatchDraft({ type: "route", route: inputMode === "shell" ? "agent" : "shell" })
      return
    }
    if (key.ctrl && key.name === "d") {
      if (input === "") quit()
      return
    }
    if (key.ctrl && key.name === "c") {
      key.preventDefault?.()
      key.stopPropagation?.()
      cancelDraft()
      return
    }
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
    const text = new TextDecoder().decode(event.bytes)
    terminalInput.writePaste(text)
  })

  return (
    <ConfigProvider>
      <FocusScope>
        {/* 主作用域：浮层打开时挂起（输入框/内嵌终端全部失焦，键盘归浮层） */}
        <FocusScope suspended={!!promotedTerminal}>
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
              {/* 轮次在途时占住流尾，仿 shell 的 prompt 未归位 */}
              {agentBusy && !permissionPending && !inlineRunning ? <AgentBusyLine /> : null}
              {/* PTY 运行中、权限待决策或 agent 轮次在途时键盘归它们，草稿不渲染 */}
              {!inlineRunning && !permissionPending && !agentBusy ? (
                <DraftCard
                  value={input}
                  onChange={changeInput}
                  onSubmit={submitLine}
                  cwd={cwd}
                  mode={inputMode}
                  shellTokens={shellLex.tokens}
                  diagnostic={diagnostic}
                  completions={completions}
                  menu={slashMenu}
                  menuIndex={menuIndex}
                  onTab={completeInput}
                  cursorVisible={draftCursorVisible}
                />
              ) : null}
            </scrollbox>
          </box>
        </FocusScope>

        {promotedTerminal ? (
          <PromotedTerminalWindow terminal={promotedTerminal} mode={promotedMode} />
        ) : null}
      </FocusScope>
    </ConfigProvider>
  )
}
