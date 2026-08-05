import { useEffect, useState } from "react"
import { homedir } from "node:os"
import { Input, useToken } from "@antd-tui/components"
import { Anterm } from "@antd-tui/anterm"
import { cardTint } from "./theme"
import type { Block } from "./types"

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

/** 命令卡片：<cwd> ❯ 命令头（输入色）+ 输出行（较暗，区分输入）+ 运行/退出码尾。 */
export function CommandCard({ block }: { block: Extract<Block, { kind: "command" }> }) {
  const token = useToken()
  return (
    <box
      style={{
        backgroundColor: cardTint.command,
        flexDirection: "column",
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
      }}
    >
      <text attributes={0}>
        <span fg={token.colorTextSecondary}>{`${shortCwd(block.cwd)} `}</span>
        <span fg={token.colorPrimaryHover}>❯ </span>
        <span fg={token.colorText}>{block.command}</span>
      </text>
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
  )
}

/**
 * 草稿卡片：流尾正在敲的下一条命令。与命令卡片头同底色、同 `<cwd> ❯ ` 头格式，
 * 故 Enter 后原样冻结成命令卡片头（所见即所得）。
 */
export function DraftCard({
  value,
  onChange,
  onSubmit,
  cwd,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  cwd: string
}) {
  const token = useToken()
  return (
    <box
      style={{
        backgroundColor: cardTint.command,
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
      }}
    >
      <text attributes={0}>
        <span fg={token.colorTextSecondary}>{`${shortCwd(cwd)} `}</span>
        <span fg={token.colorPrimaryHover}>❯ </span>
      </text>
      <Input
        value={value}
        placeholder="输入命令或对话"
        compact
        tuiOnChange={onChange}
        tuiOnPressEnter={onSubmit}
        style={{ backgroundColor: cardTint.command, flexGrow: 1 }}
      />
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
    case "agent":
      return <AgentCard block={block} />
    case "note":
      return <NoteLine block={block} />
  }
}
