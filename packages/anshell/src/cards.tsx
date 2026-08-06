import { useEffect, useRef, useState } from "react"
import { homedir } from "node:os"
import { useTerminalDimensions } from "@opentui/react"
import {
  Input,
  useToken,
  type InputEdit,
  type InputHighlight,
  type InputTabContext,
} from "@antd-tui/components"
import { Anterm, createAntermSession, type AntermSession } from "@antd-tui/anterm"
import { cardTint } from "./theme"
import { SLASH_MENU_LIMIT, type SlashCommand } from "./commands"
import type { Block, PromotedTerminal } from "./types"
import {
  SHELL_BUILTINS,
  toCodePointOffset,
  unquoteShellWord,
  type CompletionItem,
  type ShellToken,
  type SyntaxDiagnostic,
} from "./shell"

/** home 缩写成 ~ */
export function shortCwd(cwd: string): string {
  const home = homedir()
  return cwd === home ? "~" : cwd.startsWith(home + "/") ? "~" + cwd.slice(home.length) : cwd
}

/**
 * 草稿卡片：流尾正在敲的下一条输入。自动识别为 Shell 时显示 `$`，否则显示 `◆`；
 * Enter 后原样冻结成对应输入卡（所见即所得）。
 */
export function DraftCard({
  value,
  onChange,
  onSubmit,
  cwd,
  mode,
  shellTokens,
  diagnostic,
  completions,
  menu,
  menuIndex,
  onTab,
  cursorVisible,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  cwd: string
  mode: "shell" | "agent" | "command"
  shellTokens: ShellToken[]
  diagnostic: SyntaxDiagnostic | null
  completions: CompletionItem[]
  menu: SlashCommand[]
  menuIndex: number
  onTab: (context: InputTabContext) => InputEdit | void | Promise<InputEdit | void>
  cursorVisible: boolean
}) {
  const token = useToken()
  const command = shellTokens.find((item) => item.kind === "command")
  const commandName = command ? unquoteShellWord(command.text) : ""
  const commandResolved = command
    ? SHELL_BUILTINS.includes(commandName as (typeof SHELL_BUILTINS)[number]) || Bun.which(commandName) !== null
    : true
  const highlights: InputHighlight[] = mode === "shell"
    ? shellTokens.map((item) => {
        const base = {
          start: toCodePointOffset(value, item.start),
          end: toCodePointOffset(value, item.end),
        }
        switch (item.kind) {
          case "command":
            return { ...base, color: commandResolved ? token.colorPrimaryHover : token.colorError, bold: true }
          case "operator":
          case "option":
            return { ...base, color: token.colorWarning }
          case "string":
          case "path":
            return { ...base, color: token.colorSuccess }
          case "variable":
          case "assignment":
            return { ...base, color: token.colorPrimaryHover }
          case "comment":
            return { ...base, color: token.colorTextDisabled, dim: true }
          case "error":
            return { ...base, color: token.colorError, underline: true }
          default:
            return { ...base, color: token.colorText }
        }
      })
    : []
  const symbol = mode === "shell" ? "$" : mode === "command" ? "/" : "◆"
  const symbolColor = mode === "shell"
    ? token.colorPrimaryHover
    : mode === "command"
      ? token.colorSuccess
      : token.colorWarning
  const placeholder = mode === "command"
    ? "斜杠命令 · ↑↓ 选择 · Tab 补全 · Esc 收起"
    : mode === "shell"
      ? "输入 Shell 命令 · Ctrl+T 路由 · Ctrl+O 浮层"
      : "输入 Agent 提示 · / 命令 · Ctrl+T 路由 · Ctrl+O 浮层"
  const status = diagnostic?.kind === "invalid"
    ? { color: token.colorError, text: diagnostic.message }
    : diagnostic?.kind === "incomplete"
      ? { color: token.colorWarning, text: diagnostic.message }
      : null
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box
        style={{
          backgroundColor: cardTint.input,
          flexDirection: "row",
          paddingLeft: 1,
          paddingRight: 1,
          width: "100%",
        }}
      >
        <text attributes={0}>
          <span fg={token.colorTextSecondary}>{`${shortCwd(cwd)} `}</span>
          <span fg={symbolColor}>{`${symbol} `}</span>
        </text>
        <Input
          value={value}
          placeholder={placeholder}
          compact
          tuiHighlights={highlights}
          tuiShowCursor={cursorVisible}
          tuiOnTab={onTab}
          tuiOnChange={onChange}
          tuiOnPressEnter={onSubmit}
          style={{ backgroundColor: cardTint.input, flexGrow: 1 }}
        />
      </box>
      {menu.length > 0 ? (
        <box style={{ flexDirection: "column", width: "100%", backgroundColor: cardTint.output }}>
          {menu.slice(0, SLASH_MENU_LIMIT).map((item, index) => {
            const selected = index === menuIndex
            return (
              <box
                key={item.name}
                style={{
                  backgroundColor: selected ? cardTint.input : cardTint.output,
                  paddingLeft: 1,
                  paddingRight: 1,
                  width: "100%",
                  height: 1,
                  flexShrink: 0,
                  overflow: "hidden",
                }}
              >
                <text attributes={0}>
                  <span fg={selected ? token.colorSuccess : token.colorTextSecondary}>
                    {`${selected ? "▸" : " "} /${item.name}`}
                  </span>
                  <span fg={token.colorTextDisabled}>{item.hint ? ` ${item.hint}` : ""}</span>
                  <span fg={selected ? token.colorText : token.colorTextDisabled}>
                    {`  ${item.description}`}
                  </span>
                  <span fg={token.colorTextDisabled}>{item.source === "agent" ? "  · agent" : ""}</span>
                </text>
              </box>
            )
          })}
        </box>
      ) : null}
      {completions.length > 0 ? (
        <box
          style={{
            backgroundColor: cardTint.output,
            paddingLeft: 1,
            paddingRight: 1,
            width: "100%",
            height: 1,
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          <text attributes={0} fg={token.colorTextSecondary}>
            {completions.slice(0, 12).map((item) => item.label).join("  ")}
          </text>
        </box>
      ) : null}
      {status ? (
        <box
          style={{
            backgroundColor: cardTint.output,
            paddingLeft: 1,
            paddingRight: 1,
            width: "100%",
            height: 1,
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          <text attributes={0} fg={status.color}>{`! ${status.text}`}</text>
        </box>
      ) : null}
    </box>
  )
}

/** 已提交给 agent 的用户输入卡；与草稿的 ◆ 语义保持一致。 */
export function PromptCard({ block }: { block: Extract<Block, { kind: "prompt" }> }) {
  const token = useToken()
  return (
    <box style={{ backgroundColor: cardTint.input, paddingLeft: 1, paddingRight: 1, width: "100%" }}>
      <text attributes={0}>
        <span fg={token.colorTextSecondary}>{`${shortCwd(block.cwd)} `}</span>
        <span fg={token.colorWarning}>◆ </span>
        <span fg={token.colorText}>{block.text}</span>
      </text>
    </box>
  )
}

/** 内嵌 PTY 卡片：退出后保留最终终端画面，并把焦点交给下一条草稿。 */
export function TerminalCard({
  block,
  onExit,
  onPromote,
  onSessionReady,
  onSessionRelease,
}: {
  block: Extract<Block, { kind: "terminal" }>
  onExit: (exitCode: number) => void
  onPromote: (terminal: PromotedTerminal | null) => void
  onSessionReady: (session: AntermSession) => void
  onSessionRelease: (session: AntermSession) => void
}) {
  const token = useToken()
  const dims = useTerminalDimensions()
  const shell = block.prompt === "shell"
  const running = block.state === "running"
  const symbol = shell ? "$" : "▶"
  const [session, setSession] = useState<AntermSession | null>(null)
  const [promoted, setPromoted] = useState(false)
  const latest = useRef({ onExit, onPromote, onSessionReady, onSessionRelease })
  latest.current = { onExit, onPromote, onSessionReady, onSessionRelease }
  const argsKey = JSON.stringify(block.args)

  useEffect(() => {
    let isPromoted = false
    let current: AntermSession
    current = createAntermSession({
      command: block.command,
      args: block.args,
      cwd: block.cwd,
      cols: Math.max(2, dims.width),
      rows: Math.max(2, block.fullscreen ? dims.height : dims.height - 1),
      onExit: (code) => {
        latest.current.onSessionRelease(current)
        if (isPromoted) {
          isPromoted = false
          setPromoted(false)
          latest.current.onPromote(null)
        }
        latest.current.onExit(code)
      },
    })
    setSession(current)
    latest.current.onSessionReady(current)

    const syncView = () => {
      const nextPromoted = !current.exited && (block.fullscreen || current.alternateScreen)
      if (nextPromoted === isPromoted) return
      isPromoted = nextPromoted
      setPromoted(nextPromoted)
      latest.current.onPromote(nextPromoted ? {
        id: block.id,
        label: block.label,
        command: block.command,
        args: block.args,
        cwd: block.cwd,
        session: current,
      } : null)
    }
    const unsubscribe = current.onFrame(syncView)
    syncView()
    return () => {
      unsubscribe()
      if (isPromoted) latest.current.onPromote(null)
      latest.current.onSessionRelease(current)
      current.kill()
    }
    // 一张 transcript block 只创建一次会话；终端尺寸变化由下面的 resize effect 处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.command, argsKey, block.cwd])

  useEffect(() => {
    // normal-buffer takeover 的历史已经被破坏性重画；退出弹窗后保持最后视口的尺寸，
    // 再 resize 会触发 xterm reflow，把冻结画面重新拆成重复/错位的碎片。
    if (session && !promoted && !session.screenTakeover) {
      session.resize(Math.max(2, dims.width), Math.max(2, dims.height - 1))
    }
  }, [session, promoted, dims.width, dims.height])

  return (
    <box
      style={{ flexDirection: "column", gap: 0, width: "100%" }}
    >
      <box style={{ backgroundColor: cardTint.input, paddingLeft: 1, paddingRight: 1, width: "100%" }}>
        <text attributes={0}>
          <span fg={token.colorTextSecondary}>{`${shortCwd(block.cwd)} `}</span>
          <span fg={token.colorPrimaryHover}>{`${symbol} `}</span>
          <span fg={token.colorText}>{block.label}</span>
          <span fg={token.colorTextDisabled}>
            {running ? "  (PTY)" : `  (exit ${block.exitCode ?? 0})`}
          </span>
        </text>
      </box>
      {session && !promoted ? (
        <Anterm
          command={block.command}
          args={block.args}
          cwd={block.cwd}
          autoFocus={running}
          tuiSession={session}
          tuiFlow
          tuiReadOnly={!running}
          tuiKeyboardDisabled
          tuiBackgroundColor={cardTint.output}
          style={{ flexGrow: 0, flexShrink: 0 }}
        />
      ) : null}
    </box>
  )
}

/** ACP 工具调用卡片：标题 + 状态 + 输出摘要。 */
export function ToolCard({ block }: { block: Extract<Block, { kind: "tool" }> }) {
  const token = useToken()
  const statusLabel = {
    pending: "等待",
    in_progress: "运行中",
    completed: "完成",
    failed: "失败",
  }[block.status]
  const statusColor = block.status === "failed"
    ? token.colorError
    : block.status === "completed"
      ? token.colorSuccess
      : token.colorWarning
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box style={{ backgroundColor: cardTint.input, paddingLeft: 1, paddingRight: 1, width: "100%" }}>
        <text attributes={0}>
          <span fg={token.colorPrimaryHover}>* </span>
          <span fg={token.colorText}>{block.title}</span>
          <span fg={statusColor}>{`  [${statusLabel}]`}</span>
          <span fg={token.colorTextDisabled}>{block.toolKind ? `  ${block.toolKind}` : ""}</span>
        </text>
      </box>
      {block.lines.length > 0 ? (
        <box
          style={{
            backgroundColor: cardTint.output,
            flexDirection: "column",
            paddingLeft: 1,
            paddingRight: 1,
            width: "100%",
          }}
        >
          {block.lines.map((line, i) => (
            <text key={i} attributes={0} fg={token.colorTextSecondary}>
              {line === "" ? " " : line}
            </text>
          ))}
        </box>
      ) : null}
    </box>
  )
}

/** 权限卡片：待决策时按数字键选项，决策后落定结果（记忆命中会标出）。 */
export function PermissionCard({ block }: { block: Extract<Block, { kind: "permission" }> }) {
  const token = useToken()
  const pending = block.state === "pending"
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box style={{ backgroundColor: cardTint.input, paddingLeft: 1, paddingRight: 1, width: "100%" }}>
        <text attributes={0}>
          <span fg={pending ? token.colorWarning : token.colorTextSecondary}>! </span>
          <span fg={token.colorText}>{block.title}</span>
          <span fg={token.colorTextDisabled}>
            {pending ? "  需要授权" : block.auto ? `  ${block.chosen}（记忆）` : `  ${block.chosen}`}
          </span>
        </text>
      </box>
      {pending ? (
        <box
          style={{
            backgroundColor: cardTint.output,
            flexDirection: "column",
            paddingLeft: 1,
            paddingRight: 1,
            width: "100%",
          }}
        >
          {block.options.map((option, index) => (
            <text key={option.optionId} attributes={0}>
              <span fg={token.colorPrimaryHover}>{`${index + 1}. `}</span>
              <span fg={token.colorText}>{option.name}</span>
              <span fg={token.colorTextDisabled}>{`  ${option.kind}`}</span>
            </text>
          ))}
        </box>
      ) : null}
    </box>
  )
}

/** 斜杠命令卡片：`<cwd> / <命令>` 头 + 结果行，与 shell 卡片同款。 */
export function SlashCommandCard({ block }: { block: Extract<Block, { kind: "command" }> }) {
  const token = useToken()
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box style={{ backgroundColor: cardTint.input, paddingLeft: 1, paddingRight: 1, width: "100%" }}>
        <text attributes={0}>
          <span fg={token.colorTextSecondary}>{`${shortCwd(block.cwd)} `}</span>
          <span fg={token.colorSuccess}>/ </span>
          <span fg={token.colorText}>{block.name}</span>
          <span fg={token.colorTextSecondary}>{block.input === "" ? "" : ` ${block.input}`}</span>
        </text>
      </box>
      {block.lines.length > 0 ? (
        <box
          style={{
            backgroundColor: cardTint.output,
            flexDirection: "column",
            paddingLeft: 1,
            paddingRight: 1,
            width: "100%",
          }}
        >
          {block.lines.map((line, i) => (
            <text key={i} attributes={0} fg={token.colorTextSecondary}>
              {line === "" ? " " : line}
            </text>
          ))}
        </box>
      ) : null}
    </box>
  )
}

/** agent 回复卡片：◆ 前缀 + 多行文本。 */
export function AgentCard({ block }: { block: Extract<Block, { kind: "agent" }> }) {
  const token = useToken()
  const lines = block.text.split("\n")
  return (
    <box
      style={{
        backgroundColor: cardTint.agent,
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
      }}
    >
      {lines.map((line, i) => (
        <text key={i} attributes={0}>
          {i === 0 ? <span fg={token.colorWarning}>◆ </span> : <span fg={token.colorWarning}>  </span>}
          <span fg={token.colorText}>{line === "" ? " " : line}</span>
        </text>
      ))}
    </box>
  )
}

/** 纯行提示：系统/错误，不做卡片。 */
export function NoteLine({ block }: { block: Extract<Block, { kind: "note" }> }) {
  const token = useToken()
  return (
    <text
      attributes={0}
      fg={block.level === "error" ? token.colorError : token.colorTextSecondary}
      style={{ paddingLeft: 1 }}
    >
      {`· ${block.text}`}
    </text>
  )
}

/** 分发：按 block 类型渲染对应卡片。 */
export function BlockView({
  block,
  onTerminalExit,
  onTerminalPromotion,
  onTerminalSessionReady,
  onTerminalSessionRelease,
}: {
  block: Block
  onTerminalExit: (id: number, exitCode: number) => void
  onTerminalPromotion: (terminal: PromotedTerminal | null) => void
  onTerminalSessionReady: (session: AntermSession) => void
  onTerminalSessionRelease: (session: AntermSession) => void
}) {
  switch (block.kind) {
    case "terminal":
      return (
        <TerminalCard
          block={block}
          onExit={(code) => onTerminalExit(block.id, code)}
          onPromote={onTerminalPromotion}
          onSessionReady={onTerminalSessionReady}
          onSessionRelease={onTerminalSessionRelease}
        />
      )
    case "prompt":
      return <PromptCard block={block} />
    case "tool":
      return <ToolCard block={block} />
    case "permission":
      return <PermissionCard block={block} />
    case "command":
      return <SlashCommandCard block={block} />
    case "agent":
      return <AgentCard block={block} />
    case "note":
      return <NoteLine block={block} />
  }
}
