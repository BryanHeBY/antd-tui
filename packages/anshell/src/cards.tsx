import { useEffect, useState } from "react"
import { homedir } from "node:os"
import {
  Input,
  useToken,
  type InputEdit,
  type InputHighlight,
  type InputTabContext,
} from "@antd-tui/components"
import { Anterm } from "@antd-tui/anterm"
import { cardTint } from "./theme"
import type { Block } from "./types"
import {
  SHELL_BUILTINS,
  toCodePointOffset,
  unquoteShellWord,
  type CompletionItem,
  type ShellToken,
  type SyntaxDiagnostic,
} from "./shell"

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/** home 缩写成 ~ */
export function shortCwd(cwd: string): string {
  const home = homedir()
  return cwd === home ? "~" : cwd.startsWith(home + "/") ? "~" + cwd.slice(home.length) : cwd
}

/** 运行中尾行：自带 tick 定时器，条件渲染本组件即可（hook 在组件内无条件调用）。 */
function RunningFooter() {
  const token = useToken()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 120)
    return () => clearInterval(timer)
  }, [])
  return (
    <text attributes={0} fg={token.colorTextSecondary}>
      {`${SPINNER[tick % SPINNER.length]} 运行中`}
    </text>
  )
}

/**
 * 命令记录：输入卡与输出卡是两个不同底色的相邻区域。
 * 外层 gap=0，保证两张卡以及前后流项目之间不会露出空行。
 */
export function CommandCard({ block }: { block: Extract<Block, { kind: "command" }> }) {
  const token = useToken()
  const hasOutput = block.lines.length > 0 || block.running || (block.exitCode !== null && block.exitCode !== 0)
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box
        style={{
          backgroundColor: cardTint.input,
          paddingLeft: 1,
          paddingRight: 1,
          width: "100%",
        }}
      >
        <text attributes={0}>
          <span fg={token.colorTextSecondary}>{`${shortCwd(block.cwd)} `}</span>
          <span fg={token.colorPrimaryHover}>$ </span>
          <span fg={token.colorText}>{block.command}</span>
        </text>
      </box>
      {hasOutput ? (
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
            <text
              key={i}
              attributes={0}
              fg={line.stream === "err" ? token.colorError : token.colorTextSecondary}
            >
              {line.text === "" ? " " : line.text}
            </text>
          ))}
          {block.running ? (
            <RunningFooter />
          ) : block.exitCode !== null && block.exitCode !== 0 ? (
            <text attributes={0} fg={token.colorTextDisabled}>{`exit ${block.exitCode}`}</text>
          ) : null}
        </box>
      ) : null}
    </box>
  )
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
  onTab,
  cursorVisible,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  cwd: string
  mode: "shell" | "agent"
  shellTokens: ShellToken[]
  diagnostic: SyntaxDiagnostic | null
  completions: CompletionItem[]
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
  const symbol = mode === "shell" ? "$" : "◆"
  const symbolColor = mode === "shell" ? token.colorPrimaryHover : token.colorWarning
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
          placeholder={mode === "shell" ? "输入 Shell 命令 · Ctrl+T 切换" : "输入 Agent 提示 · Ctrl+T 切换"}
          compact
          tuiHighlights={highlights}
          tuiShowCursor={cursorVisible}
          tuiOnTab={onTab}
          tuiOnChange={onChange}
          tuiOnPressEnter={onSubmit}
          style={{ backgroundColor: cardTint.input, flexGrow: 1 }}
        />
      </box>
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

/** 内嵌活终端卡片：运行时固定高度嵌 Anterm，结束后折叠成摘要行。 */
export function TerminalCard({
  block,
  cwd,
  onExit,
}: {
  block: Extract<Block, { kind: "terminal" }>
  cwd: string
  onExit: (exitCode: number) => void
}) {
  const token = useToken()
  const label = [block.command, ...block.args].join(" ")

  if (block.state === "exited") {
    return (
      <box style={{ backgroundColor: cardTint.terminal, paddingLeft: 1, paddingRight: 1, width: "100%" }}>
        <text attributes={0} fg={token.colorTextSecondary}>
          {`▶ ${label}  (exit ${block.exitCode ?? 0})`}
        </text>
      </box>
    )
  }

  return (
    <box
      style={{
        backgroundColor: cardTint.terminal,
        flexDirection: "column",
        height: 16,
        width: "100%",
      }}
    >
      <text attributes={0} fg={token.colorPrimaryHover} style={{ paddingLeft: 1 }}>
        {`▶ ${label}  ·  Ctrl+] 交还焦点`}
      </text>
      <Anterm
        command={block.command}
        args={block.args}
        cwd={cwd}
        autoFocus
        onExit={onExit}
        style={{ flexGrow: 1 }}
      />
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
  cwd,
  onTerminalExit,
}: {
  block: Block
  cwd: string
  onTerminalExit: (id: number, exitCode: number) => void
}) {
  switch (block.kind) {
    case "command":
      return <CommandCard block={block} />
    case "terminal":
      return <TerminalCard block={block} cwd={cwd} onExit={(code) => onTerminalExit(block.id, code)} />
    case "prompt":
      return <PromptCard block={block} />
    case "agent":
      return <AgentCard block={block} />
    case "note":
      return <NoteLine block={block} />
  }
}
