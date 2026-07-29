/**
 * vibe-tui CLI：完全由 agent 驱动的 TUI 操作界面。
 *
 * 用法：
 *   vibe-tui --agent "bun path/to/acp-agent.ts"          # 新建临时会话（退出即删）
 *   vibe-tui --agent "qodercli --acp" --resume <id>      # 复用既有会话（历史回放，退出不删）
 *   vibe-tui --agent "qodercli --acp" --resume           # 列出 agent 侧会话供选择
 *
 * 交互：下方输入框输入 prompt（Enter 发送）；F2 进入页面模式操作画板，F3 对话记录，
 * Esc 返回；鼠标随时可点画板。Ctrl+C 退出。
 */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import React from "react"
import { VibeApp } from "./VibeApp"
import { listAgentSessions } from "./acp"

interface CliArgs {
  agentCmd: string[] | null
  /** undefined = 未指定；"" = 裸 --resume（列出会话）；其余为 sessionId */
  resume?: string
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { agentCmd: null }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--agent": {
        const raw = argv[++i]
        if (raw) args.agentCmd = raw.split(/\s+/).filter(Boolean)
        break
      }
      case "--resume": {
        const next = argv[i + 1]
        if (next && !next.startsWith("--")) {
          args.resume = next
          i++
        } else {
          args.resume = ""
        }
        break
      }
    }
  }
  return args
}

async function main(): Promise<void> {
  const { agentCmd, resume } = parseArgs(process.argv.slice(2))
  if (!agentCmd || agentCmd.length === 0) {
    process.stderr.write('用法：vibe-tui --agent "<启动 ACP agent 的命令>" [--resume [sessionId]]\n')
    process.exit(2)
  }

  // 裸 --resume：列出会话后退出，供用户挑 sessionId
  if (resume === "") {
    try {
      const sessions = await listAgentSessions(agentCmd)
      if (sessions.length === 0) {
        process.stdout.write("agent 侧没有可恢复的会话\n")
      } else {
        for (const s of sessions) {
          process.stdout.write(
            `${s.sessionId}  ${s.updatedAt ?? ""}  ${s.title ?? "(无标题)"}\n`,
          )
        }
        process.stdout.write('\n用 --resume <sessionId> 恢复指定会话\n')
      }
      process.exit(0)
    } catch (err) {
      process.stderr.write(`列出会话失败：${(err as Error).message}\n`)
      process.exit(1)
    }
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write("vibe-tui 需要在真实终端（TTY）中运行\n")
    process.exit(3)
  }

  // Ctrl+C 由 VibeApp 接管：先删临时会话再退出
  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  createRoot(renderer).render(
    React.createElement(VibeApp, { agentCmd, resumeSessionId: resume || undefined }),
  )
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`)
  process.exit(1)
})
