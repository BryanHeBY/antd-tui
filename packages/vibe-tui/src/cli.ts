/**
 * vibe-tui CLI：完全由 agent 驱动的 TUI 操作界面。
 *
 * 用法：
 *   vibe-tui --agent "bun path/to/acp-agent.ts"    # agent 启动命令（ACP over stdio）
 *
 * 交互：下方输入框输入 prompt（Enter 发送）；F2 进入页面模式操作画板，Esc 返回；
 * 鼠标随时可点画板。Ctrl+C 退出。
 */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import React from "react"
import { VibeApp } from "./VibeApp"

function parseAgentCmd(argv: string[]): string[] | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent") {
      const raw = argv[i + 1]
      if (!raw) return null
      return raw.split(/\s+/).filter(Boolean)
    }
  }
  return null
}

async function main(): Promise<void> {
  const agentCmd = parseAgentCmd(process.argv.slice(2))
  if (!agentCmd || agentCmd.length === 0) {
    process.stderr.write('用法：vibe-tui --agent "<启动 ACP agent 的命令>"\n')
    process.exit(2)
  }
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write("vibe-tui 需要在真实终端（TTY）中运行\n")
    process.exit(3)
  }

  // Ctrl+C 由 VibeApp 接管：先删临时会话再退出
  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  createRoot(renderer).render(React.createElement(VibeApp, { agentCmd }))
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`)
  process.exit(1)
})
