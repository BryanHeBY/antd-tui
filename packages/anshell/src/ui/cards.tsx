import { useEffect, useMemo, useState } from "react"
import { homedir } from "node:os"
import type { StyledText } from "@opentui/core"
import {
  Input,
  useToken,
  type InputEdit,
  type InputHighlight,
  type InputTabContext,
} from "@antd-tui/components"
import type { AntermSession } from "@antd-tui/anterm"
import { cardTint } from "./theme"
import { SLASH_MENU_LIMIT, type SlashCommand } from "../agent/commands"
import type { Block } from "../types"
import {
  SHELL_BUILTINS,
  toCodePointOffset,
  unquoteShellWord,
  type CompletionItem,
  type ShellToken,
  type SyntaxDiagnostic,
} from "../shell"

/** home 缩写成 ~ */
export function shortCwd(cwd: string): string {
  const home = homedir()
  return cwd === home ? "~" : cwd.startsWith(home + "/") ? "~" + cwd.slice(home.length) : cwd
}

/**
 * 提示符 chip：cwd 做成一块主色徽章。底色取 `colorPrimary`（暗色派生出的深蓝）而不是
 * 又一档灰——灰阶之间差异太小，扫视时抓不住。所有带 cwd 的卡片头（草稿/prompt/PTY/
 * 斜杠命令）共用它，「在哪里」于是在整列卡片里对齐成一条视觉锚线；用户覆盖主色时
 * 徽章跟着变。
 */
/**
 * 徽章底色 = 主色再压暗一档。直接用 `colorPrimary` 配主色系文字对比度不够，
 * 压暗后配纯白才读得清；仍从主题派生，用户覆盖主色时徽章跟着变。
 */
function badgeBackground(primary: string): string {
  const hex = primary.replace("#", "")
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return primary
  const channels = [0, 2, 4].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * 0.55))
  return `#${channels.map((value) => value.toString(16).padStart(2, "0")).join("")}`
}

export function PromptChip({ cwd }: { cwd: string }) {
  const token = useToken()
  const background = useMemo(() => badgeBackground(token.colorPrimary), [token.colorPrimary])
  return (
    <box
      style={{
        backgroundColor: background,
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
        flexShrink: 0,
      }}
    >
      <text attributes={0} fg="#ffffff">
        {shortCwd(cwd)}
      </text>
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
  completionIndex,
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
  completionIndex: number
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
  // 斜杠命令：用户敲的那个 / 本身就是提示符，所以不另加前缀，只把 /name 染色，
  // 避免出现 `/ /session` 这种双斜杠、也让卡片与草稿逐字一致。
  const slashHead = mode === "command" ? (value.match(/^\s*\/\S*/)?.[0].length ?? 0) : 0
  const highlights: InputHighlight[] = mode === "command"
    ? [{ start: 0, end: toCodePointOffset(value, slashHead), color: token.colorSuccess, bold: true }]
    : mode === "shell"
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
  const symbol = mode === "shell" ? "$ " : mode === "command" ? "" : "◆ "
  const symbolColor = mode === "shell" ? token.colorPrimaryHover : token.colorWarning
  const placeholder = mode === "command"
    ? "斜杠命令 · ↑↓ 选择 · Tab 补全 · Ctrl+T 当作路径 · Esc 收起"
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
          paddingRight: 1,
          width: "100%",
        }}
      >
        <PromptChip cwd={cwd} />
        {/* 原生 input 在徽章后自带一格：shell/agent 的符号补一个空格，各路由的
            提示符与命令文本才在同一列起笔（斜杠命令的 / 由 input 自己渲染） */}
        <text attributes={0} fg={symbolColor}>{symbol === "" ? "" : ` ${symbol}`}</text>
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
        <box style={{ flexDirection: "column", width: "100%", backgroundColor: cardTint.output }}>
          {completions.slice(0, SLASH_MENU_LIMIT).map((item, index) => {
            const selected = index === completionIndex
            return (
              <box
                key={`${item.value}-${index}`}
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
                  <span fg={selected ? token.colorSuccess : token.colorText}>
                    {`${selected ? "▸" : " "} ${item.label}`}
                  </span>
                  <span fg={token.colorTextDisabled}>{`  ${item.kind}`}</span>
                  <span fg={token.colorTextSecondary}>{item.description ? `  ${item.description}` : ""}</span>
                </text>
              </box>
            )
          })}
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
    <box
      style={{
        backgroundColor: cardTint.input,
        flexDirection: "row",
        paddingRight: 1,
        width: "100%",
      }}
    >
      <PromptChip cwd={block.cwd} />
      <text attributes={0}>
        <span fg={token.colorWarning}> ◆ </span>
        <span fg={token.colorText}>{block.text}</span>
      </text>
    </box>
  )
}

/**
 * 一条 shell 命令的卡片：头（`<cwd> $ <整行>  (exit N)`）+ 输出行。
 * 运行中与冻结共用同一渲染，只是行的来源不同——lines 由调用方给。
 */
export function ShellCard({
  block,
  lines,
}: {
  block: Extract<Block, { kind: "shell" }>
  lines: StyledText[]
}) {
  const token = useToken()
  const running = block.state === "running"
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box
        style={{
          backgroundColor: cardTint.input,
          flexDirection: "row",
          paddingRight: 1,
          width: "100%",
        }}
      >
        <PromptChip cwd={block.cwd} />
        <text attributes={0}>
          <span fg={token.colorPrimaryHover}>{" $ "}</span>
          <span fg={token.colorText}>{block.label}</span>
          <span fg={token.colorTextDisabled}>
            {running ? "  (运行中)" : `  (exit ${block.exitCode ?? 0})`}
            {block.degraded ? "  ·降级" : ""}
          </span>
        </text>
      </box>
      {lines.length > 0 ? (
        <box
          style={{
            backgroundColor: cardTint.output,
            flexDirection: "column",
            width: "100%",
            flexShrink: 0,
          }}
        >
          {lines.map((line, i) => (
            <text key={i} attributes={0} content={line} style={{ height: 1, flexShrink: 0 }} />
          ))}
        </box>
      ) : null}
    </box>
  )
}

/** 运行中的 shell 卡片：订阅共享会话的帧，每帧从行区间重新派生输出。 */
export function RunningShellCard({
  block,
  session,
  derive,
}: {
  block: Extract<Block, { kind: "shell" }>
  session: AntermSession
  derive: () => StyledText[]
}) {
  const [, setFrame] = useState(0)
  useEffect(() => session.onFrame(() => setFrame((v) => v + 1)), [session])
  return <ShellCard block={block} lines={derive()} />
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

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

/**
 * agent 轮次在途时占住流尾：仿 shell「prompt 未归位」，一轮没结束就不发新的草稿卡，
 * 否则输入卡会先冒出来、agent 的文字再插到它上面。自带 tick 定时器，条件渲染即可。
 */
export function AgentBusyLine() {
  const token = useToken()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 120)
    return () => clearInterval(timer)
  }, [])
  return (
    <box style={{ backgroundColor: cardTint.input, paddingLeft: 1, paddingRight: 1, width: "100%" }}>
      <text attributes={0}>
        <span fg={token.colorWarning}>{`${SPINNER[tick % SPINNER.length]} `}</span>
        <span fg={token.colorTextSecondary}>运行中 · Esc 中断</span>
      </text>
    </box>
  )
}

/** 斜杠命令卡片：`<cwd> / <命令>` 头 + 结果行，与 shell 卡片同款。 */
export function SlashCommandCard({ block }: { block: Extract<Block, { kind: "command" }> }) {
  const token = useToken()
  return (
    <box style={{ flexDirection: "column", gap: 0, width: "100%" }}>
      <box
        style={{
          backgroundColor: cardTint.input,
          flexDirection: "row",
          paddingRight: 1,
          width: "100%",
        }}
      >
        <PromptChip cwd={block.cwd} />
        <text attributes={0}>
          {/* 草稿里原生 input 在徽章后自带一格，卡片补一个空格才与所打对齐 */}
          <span fg={token.colorSuccess}>{` /${block.name}`}</span>
          <span fg={token.colorTextSecondary}>{block.input === "" ? "" : ` ${block.input}`}</span>
        </text>
      </box>
      {block.rows.length > 0 ? (
        <box
          style={{
            backgroundColor: cardTint.output,
            flexDirection: "column",
            paddingLeft: 1,
            paddingRight: 1,
            width: "100%",
          }}
        >
          {block.rows.map((row, i) => (
            <text key={i} attributes={0}>
              <span fg={token.colorTextDisabled}>{row.marker ? `${row.marker} ` : ""}</span>
              <span
                fg={
                  row.tone === "error"
                    ? token.colorError
                    : row.current
                      ? token.colorSuccess
                      : token.colorText
                }
              >
                {row.primary}
              </span>
              <span fg={token.colorWarning}>{row.hint ? ` ${row.hint}` : ""}</span>
              <span fg={token.colorTextSecondary}>{row.detail ? `  ${row.detail}` : ""}</span>
              <span fg={token.colorTextDisabled}>{row.note ? `  ${row.note}` : ""}</span>
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
  // agent 的 chunk 通常以换行收尾，直接 split 会在卡片底部留一行空白，
  // 与「流项目之间不留空行」相悖
  const lines = block.text.replace(/\n+$/, "").split("\n")
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
  runningShell,
}: {
  block: Block
  /** 当前在飞的 shell 命令：id 匹配时该卡片改走实时派生 */
  runningShell?: { blockId: number; session: AntermSession; derive: () => StyledText[] } | null
}) {
  switch (block.kind) {
    case "shell":
      if (block.state === "running" && runningShell && runningShell.blockId === block.id) {
        return (
          <RunningShellCard block={block} session={runningShell.session} derive={runningShell.derive} />
        )
      }
      return <ShellCard block={block} lines={block.lines ?? []} />
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
