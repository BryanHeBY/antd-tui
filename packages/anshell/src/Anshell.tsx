import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, usePaste } from "@opentui/react"
import { ConfigProvider, FocusScope, toBoxStyle } from "@antd-tui/components"
import { AcpClient, type AvailableCommand, type SessionConfigOption, type SessionModeState } from "@antd-tui/acp"
import { classifyInput } from "./triage"
import { useTranscript } from "./transcript"
import { AgentBusyLine, BlockView, DraftCard } from "./cards"
import { draftReducer, initialDraftState } from "./draft-state"
import { PromotedTerminalWindow } from "./overlays"
import { useShellSession } from "./useShellSession"
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
import type { AnshellProps, CommandRow } from "./types"
import {
  checkShellSyntax,
  commonPrefix,
  completeLive,
  completeShellInput,
  lexShell,
  resolveShellDialect,
} from "./shell"

/**
 * anshell：agent 时代的对话式 shell（流式布局 + shell 行内输入）。
 *
 * 所有命令跑在**一条长驻交互 shell** 里，靠 OSC 133 语义标记切成卡片——export/source/
 * 别名/作业表跨命令留存。输入是流尾草稿卡的可编辑头部（Shell `$`、Agent `◆`、斜杠 `/`）。
 * 命令进入 alternate screen（或 Ctrl+O 强制）时提升为浮层；自然语言交给 agent。
 */
export function Anshell({
  cwd: initialCwd,
  shell,
  shellInit,
  overlayCommands,
  agentCmd,
  onQuit,
  style,
}: AnshellProps) {
  const startCwd = initialCwd ?? process.cwd()
  const resolved = useMemo(() => resolveShellDialect(shell), [shell])
  const [draft, dispatchDraft] = useReducer(draftReducer, initialDraftState)
  const { input, routeOverride, diagnostic, completions, completionOpen, completionIndex, menuOpen, menuIndex } = draft
  const [draftCursorVisible, setDraftCursorVisible] = useState(true)
  const [agentReady, setAgentReady] = useState(false)
  const [agentCommands, setAgentCommands] = useState<AvailableCommand[]>([])
  const [agentModes, setAgentModes] = useState<SessionModeState | null>(null)
  const [agentConfig, setAgentConfig] = useState<SessionConfigOption[]>([])
  const [agentUsage, setAgentUsage] = useState<string | null>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const transcript = useTranscript()

  const clientRef = useRef<AcpClient | null>(null)
  const quittingRef = useRef(false)
  const history = useRef<string[]>([])
  const historyPos = useRef<number>(-1)
  const scrollRef = useRef<ScrollBoxRenderable | null>(null)
  const policy = useMemo(() => new PermissionPolicy(), [])
  // shell 自报的已知命令名（含函数/别名）；就绪后填充，供分诊避免把 ll/gs 误判为 agent
  const knownCommands = useRef<Set<string>>(new Set())
  const pendingPermission = useRef<{
    blockId: number
    tool: string
    options: Array<{ optionId: string; name: string; kind: string }>
    resolve: (decision: { outcome: "selected"; optionId: string } | { outcome: "cancelled" }) => void
  } | null>(null)
  const draftCursorVisibleRef = useRef(true)

  const transcriptRef = useRef(transcript)
  transcriptRef.current = transcript

  // 长驻 shell（resolved.dialect 已在 CLI 层保证非 null；库消费方传错时下面兜底提示）
  const shellCtl = useShellSession({
    path: resolved.path,
    dialect: resolved.dialect ?? "bash",
    cwd: startCwd,
    init: shellInit ?? "user",
    events: useMemo(
      () => ({
        onSubmitStart: () => {},
        onCwd: () => {},
        onShellExit: () => quitRef.current(),
        addShell: (label: string, cwd: string, options?: { requestedOverlay?: boolean }) =>
          transcriptRef.current.addShell(label, cwd, options),
        closeShell: (id, result) => transcriptRef.current.closeShell(id, result),
      }),
      [],
    ),
  })
  const cwd = shellCtl.cwd
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const overlaySet = useMemo(() => new Set(overlayCommands ?? []), [overlayCommands])
  const autoTriage = useMemo(
    () =>
      classifyInput(input, {
        which: (command) => knownCommands.current.has(command) || Bun.which(command) != null,
      }),
    [input],
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
  const inputMode: "shell" | "agent" | "command" = slash
    ? "command"
    : (routeOverride ?? (autoTriage.kind === "agent" ? "agent" : "shell"))
  const shellLex = useMemo(() => lexShell(input), [input])

  const running = shellCtl.running !== null
  const promoted = shellCtl.promoted
  const permissionPending = transcript.blocks.some((b) => b.kind === "permission" && b.state === "pending")

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
  const quitRef = useRef(quit)
  quitRef.current = quit

  // shell 就绪后、以及每次命令结束回到空闲时，问它要一份命令名表（含函数/别名）——
  // 别名可能是刚刚这条命令定义的，只在启动时拉一次会把新别名误判成 agent
  useEffect(() => {
    if (!shellCtl.ready || running) return
    const script =
      resolved.dialect === "zsh"
        ? "print -rl -- ${(k)commands} ${(k)builtins} ${(k)functions} ${(k)aliases}"
        : "compgen -abck"
    let cancelled = false
    void shellCtl
      .runHidden(script)
      .then((out) => {
        if (!cancelled) knownCommands.current = new Set(out.split("\n").filter(Boolean))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [shellCtl.ready, running, resolved.dialect])

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
      // agent 的工作区根钉在启动 cwd；cd 不改会话，重开会话会丢对话状态
      { ephemeral: true, cwd: startCwd },
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
  }, [agentCmd, decidePermission, startCwd])

  // Shell 语法诊断（不参与分诊）
  useEffect(() => {
    let cancelled = false
    if (inputMode !== "shell" || input.trim() === "") return
    const timer = setTimeout(() => {
      void checkShellSyntax(input, resolved.path, cwdRef.current)
        .then((result) => {
          if (!cancelled && result.kind !== "valid") dispatchDraft({ type: "diagnostic", diagnostic: result })
        })
        .catch((error: unknown) => {
          if (!cancelled)
            dispatchDraft({
              type: "diagnostic",
              diagnostic: { kind: "invalid", message: `语法检查失败：${(error as Error).message}` },
            })
        })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [input, inputMode, resolved.path])

  const changeInput = useCallback((value: string) => {
    dispatchDraft({ type: "change", input: value })
  }, [])

  const cancelDraft = useCallback(() => {
    dispatchDraft({ type: "reset" })
    historyPos.current = -1
  }, [])

  const completeInput = useCallback(
    async ({ value, cursor }: { value: string; cursor: number }) => {
      if (inputMode !== "shell" && routeOverride === "agent") return
      // 下拉框已展开时，Tab 前进选中项（zsh menu-complete 手感）
      if (completionOpenRef.current && completionsRef.current.length > 0) {
        dispatchDraft({
          type: "completionMove",
          delta: 1,
          count: Math.min(completionsRef.current.length, SLASH_MENU_LIMIT),
        })
        return
      }
      // bash 走真实补全（complete/compgen spec），超时/为空回退启发式；zsh 暂用启发式
      let result = null
      if (resolved.dialect === "bash" && shellCtl.session) {
        result = await completeLive(shellCtl.session, value, cursor).catch(() => null)
      }
      if (!result || result.items.length === 0) {
        result = await completeShellInput(value, cursor, cwdRef.current)
      }
      if (result.items.length === 0) {
        dispatchDraft({ type: "completions", completions: [] })
        return
      }
      const chars = Array.from(value)
      const current = chars.slice(result.start, result.end).join("")
      let replacement = ""
      if (result.items.length === 1) {
        const only = result.items[0]!
        const suffix = only.kind === "directory" || result.nospace ? "" : " "
        replacement = `${only.value}${suffix}`
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
      completionRangeRef.current = { start: result.start, end: result.end, nospace: !!result.nospace }
      dispatchDraft({ type: "completions", completions: result.items.slice(0, 50) })
    },
    [inputMode, routeOverride, resolved.dialect, shellCtl],
  )
  // Tab 前进选中项需要读到最新的展开态/候选，用 ref 避免闭包过期
  const completionOpenRef = useRef(completionOpen)
  completionOpenRef.current = completionOpen
  const completionsRef = useRef(completions)
  completionsRef.current = completions
  const completionRangeRef = useRef<{ start: number; end: number; nospace: boolean }>({
    start: 0,
    end: 0,
    nospace: false,
  })

  /** Enter 接受当前选中的补全项，替换当前词。 */
  const acceptCompletion = useCallback((): boolean => {
    const item = completions[completionIndex]
    if (!item) return false
    const { start, end, nospace } = completionRangeRef.current
    const chars = Array.from(input)
    const suffix = item.kind === "directory" || nospace ? "" : " "
    const next = [...chars.slice(0, start), item.value + suffix, ...chars.slice(end)].join("")
    changeInput(next)
    return true
  }, [completions, completionIndex, input, changeInput])

  /**
   * 斜杠命令执行：本地命令映射到真正的 ACP 方法，其余名字按 agent 命令编译成 prompt 文本。
   */
  const runSlashCommand = useCallback(
    (name: string, rest: string) => {
      const t = latest.current.transcript
      const cwd = cwdRef.current
      const client = clientRef.current
      const say = (text: string): CommandRow[] => [{ primary: text }]
      const requireAgent = (): boolean => {
        if (client) return true
        t.addCommand(name, rest, cwd, [
          { primary: "未配置 agent", detail: "用 ansh --agent \"<命令>\" 接入", tone: "error" },
        ])
        return false
      }
      const fail = (id: number) => (err: Error) =>
        t.setCommandRows(id, [{ primary: "失败", detail: err.message, tone: "error" }])
      const pending = (): CommandRow[] => [{ primary: "…" }]

      switch (name) {
        case "help": {
          t.addCommand(
            name,
            rest,
            cwd,
            listCommands(latest.current.slashContext).map((command) => ({
              primary: `/${command.name}`,
              hint: command.hint,
              detail: command.description,
              note: command.source === "agent" ? "· agent" : undefined,
              current: true,
            })),
          )
          return
        }
        case "session": {
          if (!requireAgent()) return
          const [verb, arg] = rest.split(/\s+/).filter(Boolean)
          const id = t.addCommand(name, rest, cwd, pending())
          if (verb === undefined) {
            void client!
              .listSessions()
              .then((sessions) =>
                t.setCommandRows(id, [
                  { marker: "当前会话", primary: client!.sessionId ?? "—", current: true },
                  ...sessions.map((session) => {
                    const isCurrent = session.sessionId === client!.sessionId
                    return {
                      marker: isCurrent ? "▸" : " ",
                      primary: session.sessionId,
                      current: isCurrent,
                      detail: [session.updatedAt, session.title].filter(Boolean).join("  "),
                    }
                  }),
                  ...(sessions.length === 0 ? [{ primary: "（agent 未返回会话列表）" }] : []),
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
                t.setCommandRows(id, [{ marker: "已新建会话", primary: sessionId, current: true }])
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
                t.setCommandRows(id, [
                  { marker: "已切换到会话", primary: arg, detail: "历史经 session/update 回放", current: true },
                ])
              })
              .catch(fail(id))
            return
          }
          if (verb === "delete" && arg) {
            void client!
              .deleteSession(arg)
              .then(() => t.setCommandRows(id, [{ marker: "已删除会话", primary: arg }]))
              .catch(fail(id))
            return
          }
          t.setCommandRows(id, [{ primary: "用法", detail: "/session [new | load <id> | delete <id>]" }])
          return
        }
        case "mode": {
          if (!requireAgent()) return
          const modes = client!.modes
          if (!modes) {
            t.addCommand(name, rest, cwd, say("该 agent 未声明会话模式"))
            return
          }
          if (rest === "") {
            t.addCommand(
              name,
              rest,
              cwd,
              modes.availableModes.map((mode) => {
                const isCurrent = mode.id === modes.currentModeId
                return {
                  marker: isCurrent ? "▸" : " ",
                  primary: mode.id,
                  current: isCurrent,
                  detail: [mode.name === mode.id ? "" : mode.name, mode.description ?? ""]
                    .filter(Boolean)
                    .join("  "),
                }
              }),
            )
            return
          }
          const id = t.addCommand(name, rest, cwd, pending())
          void client!
            .setMode(rest)
            .then(() => {
              setAgentModes(client!.modes)
              t.setCommandRows(id, [{ marker: "已切到模式", primary: rest, current: true }])
            })
            .catch(fail(id))
          return
        }
        case "model": {
          if (!requireAgent()) return
          const option = findModelOption(client!.configOptions)
          if (!option || option.type !== "select") {
            t.addCommand(name, rest, cwd, say("该 agent 未提供模型配置项"))
            return
          }
          const choices = option.options.flatMap((entry) => ("group" in entry ? entry.options : [entry]))
          if (rest === "") {
            t.addCommand(
              name,
              rest,
              cwd,
              choices.map((choice) => {
                const isCurrent = choice.value === option.currentValue
                return {
                  marker: isCurrent ? "▸" : " ",
                  primary: choice.value,
                  current: isCurrent,
                  detail: choice.name,
                }
              }),
            )
            return
          }
          const id = t.addCommand(name, rest, cwd, pending())
          void client!
            .setConfigOption(option.id, rest)
            .then((options) => {
              setAgentConfig(options)
              t.setCommandRows(id, [{ marker: "已切到", primary: rest, current: true }])
            })
            .catch(fail(id))
          return
        }
        case "cancel": {
          if (!requireAgent()) return
          client!.cancel()
          t.addCommand(name, rest, cwd, say("已发送 session/cancel"))
          return
        }
        case "usage": {
          if (!requireAgent()) return
          const usage = latest.current.agentUsage
          t.addCommand(
            name,
            rest,
            cwd,
            usage ? [{ marker: "上下文", primary: usage, current: true }] : say("agent 未上报 usage"),
          )
          return
        }
        case "permissions": {
          if (rest === "reset") {
            const count = policy.forget()
            t.addCommand(name, rest, cwd, [{ primary: `已清空 ${count} 条权限记忆`, detail: "审计流水保留" }])
            return
          }
          const rows: CommandRow[] = [
            ...[...policy.memory.entries()].map(([tool, decision]) => ({
              marker: "记忆",
              primary: tool,
              detail: `→ ${decision.option}（${decision.kind}）`,
              current: true,
            })),
            ...policy.records.map((record) => ({
              marker: `#${record.seq}`,
              primary: record.tool,
              detail: `→ ${record.option}  ${record.outcome}${record.auto ? "（记忆）" : ""}`,
              tone: record.outcome === "rejected" ? ("error" as const) : undefined,
            })),
          ]
          t.addCommand(name, rest, cwd, rows.length > 0 ? rows : say("暂无权限记录"))
          return
        }
        default: {
          if (!requireAgent()) return
          t.addCommand(name, rest, cwd, say("已交给 agent"))
          client!.prompt(compileAgentCommand(name, rest))
        }
      }
    },
    [policy],
  )

  const acceptMenu = useCallback((): boolean => {
    const item = slashMenu[menuIndex]
    if (!item) return false
    const rest = slash?.rest ?? ""
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
    if (completionOpen && completions.length > 0 && acceptCompletion()) return
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

    // clear 是唯一宿主内建：只清卡片流，不动 shell
    const argv0 = line.split(/\s+/).filter(Boolean)[0] ?? ""
    if (argv0 === "clear") {
      transcript.clear()
      return
    }
    // 其余（含 cd / pwd / exit）交给长驻 shell
    shellCtl.submit(line, { requestedOverlay: overlaySet.has(argv0) })
  }, [
    acceptCompletion,
    acceptMenu,
    completionOpen,
    completions,
    input,
    inputMode,
    menuOpen,
    overlaySet,
    runSlashCommand,
    shellCtl,
    slashMenu,
    transcript,
  ])

  const submitInteractiveLine = useCallback(() => {
    const line = input.trim()
    if (line === "") return
    dispatchDraft({ type: "reset" })
    historyPos.current = -1
    history.current.push(line)
    shellCtl.submit(line, { requestedOverlay: true })
  }, [input, shellCtl])

  useKeyboard((key) => {
    // 命令在飞：键盘原样进 PTY（encodeKey 已把 Ctrl-C/D/Z 编成 \x03/\x04/\x1a）
    if (shellCtl.isBusy()) {
      key.preventDefault?.()
      key.stopPropagation?.()
      if (key.eventType === "release") return
      if (promoted && key.ctrl && key.name === "o") {
        shellCtl.togglePromotedMode()
        return
      }
      shellCtl.writeKey(key)
      return
    }

    // 权限待决策：键盘完全归卡片
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

    // agent 轮次在途：Esc/Ctrl-C 中断
    if (agentBusy) {
      if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        key.preventDefault?.()
        key.stopPropagation?.()
        clientRef.current?.cancel()
      }
      return
    }

    // 补全下拉框方向键/Esc 抢在斜杠菜单与命令历史之前
    if (completionOpen && completions.length > 0) {
      if (key.name === "up" || key.name === "down") {
        key.preventDefault?.()
        key.stopPropagation?.()
        dispatchDraft({
          type: "completionMove",
          delta: key.name === "down" ? 1 : -1,
          count: Math.min(completions.length, SLASH_MENU_LIMIT),
        })
        return
      }
      if (key.name === "escape") {
        key.preventDefault?.()
        key.stopPropagation?.()
        dispatchDraft({ type: "completionClose" })
        return
      }
    }

    // 斜杠菜单方向键/Esc 抢在命令历史翻阅之前
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
    if (shellCtl.isBusy()) shellCtl.writePaste(text)
  })

  const runningShell =
    shellCtl.running && shellCtl.session
      ? {
          blockId: shellCtl.running.blockId,
          session: shellCtl.session.anterm,
          derive: () => shellCtl.deriveRunning(shellCtl.running?.start ?? null),
        }
      : null

  return (
    <ConfigProvider>
      <FocusScope>
        {/* 主作用域：浮层打开时挂起 */}
        <FocusScope suspended={!!promoted}>
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
                <BlockView key={block.id} block={block} runningShell={runningShell} />
              ))}
              {agentBusy && !permissionPending && !running ? <AgentBusyLine /> : null}
              {/* 命令在飞、权限待决策或 agent 轮次在途时键盘归它们，草稿不渲染 */}
              {!running && !permissionPending && !agentBusy ? (
                <DraftCard
                  value={input}
                  onChange={changeInput}
                  onSubmit={submitLine}
                  cwd={cwd}
                  mode={inputMode}
                  shellTokens={shellLex.tokens}
                  diagnostic={diagnostic}
                  completions={completions}
                  completionIndex={completionIndex}
                  menu={slashMenu}
                  menuIndex={menuIndex}
                  onTab={completeInput}
                  cursorVisible={draftCursorVisible}
                />
              ) : null}
            </scrollbox>
          </box>
        </FocusScope>

        {promoted ? <PromotedTerminalWindow terminal={promoted} mode={shellCtl.promotedMode} /> : null}
      </FocusScope>
    </ConfigProvider>
  )
}
