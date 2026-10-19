/**
 * vibe-tui CLI：完全由 agent 驱动的 TUI 操作界面。
 *
 * 用法：
 *   vibe-tui [--config <json>] [--model provider/model] [--effort <level>]
 *                                                       # 默认 pi 原生后端：进程内、全内存、无 MCP HTTP
 *   vibe-tui --acp "bun path/to/acp-agent.ts"           # ACP 子进程后端，新建临时会话（退出即删）
 *   vibe-tui --acp "qodercli --acp" --resume <id>       # 复用既有会话（历史回放，退出不删）
 *   vibe-tui --acp "qodercli --acp" --resume            # 列出 agent 侧会话供选择
 *
 * 交互：下方输入框输入 prompt（Enter 发送）；Tab 循环切换 输入 → 页面模式（操作画板）→ 对话记录 → 输入，
 * Esc 返回；鼠标随时可点画板。Ctrl+C 退出。
 */
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import React from "react"
import { VibeApp, type AgentBackend } from "./VibeApp"
import { listAgentSessions } from "@antd-tui/acp"
import { buildPiRuntime, PI_EFFORTS, type PiEffort } from "@antd-tui/pi-agent"

const EFFORTS: readonly string[] = PI_EFFORTS
interface CliArgs {
  acpCmd: string[] | null
  effort?: PiEffort
  model?: string
  config?: string
  /** undefined = 未指定；"" = 裸 --resume（列出会话）；其余为 sessionId */
  resume?: string
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { acpCmd: null }
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--acp": {
        const raw = argv[++i]
        if (raw) args.acpCmd = raw.split(/\s+/).filter(Boolean)
        break
      }
      case "--config": {
        const raw = argv[++i]
        if (raw) args.config = raw
        break
      }
      case "--model": {
        const raw = argv[++i]
        if (raw) args.model = raw
        break
      }
      case "--effort": {
        const raw = argv[++i]
        if (raw) args.effort = raw as PiEffort
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
  const { acpCmd, config, model, effort, resume } = parseArgs(process.argv.slice(2))

  // 后端选择：缺省 = pi 原生后端（模型/effort/凭据来自 --config 文件，
  // 覆盖链 --model/--effort > PI_MODEL/PI_EFFORT > 配置）；--acp "<命令>" = ACP 子进程。
  if (resume !== undefined && !acpCmd) {
    process.stderr.write('恢复会话需要 ACP 后端（--acp "<命令>" --resume）；pi 原生后端是全内存会话\n')
    process.exit(2)
  }
  let backend: AgentBackend
  if (acpCmd) {
    backend = { kind: "acp", cmd: acpCmd }
  } else {
    if (effort !== undefined && !EFFORTS.includes(effort)) {
      process.stderr.write(`--effort 应为 ${EFFORTS.join("/")}\n`)
      process.exit(2)
    }
    try {
      backend = {
        kind: "pi",
        spec: model,
        config,
        effort,
        runtime: buildPiRuntime({ configPath: config, model, effort }),
      }
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`)
      process.exit(2)
    }
  }


  // 裸 --resume：列出会话后退出，供用户挑 sessionId
  if (resume === "") {
    try {
      // pi+--resume 已在上面的守卫退出，这里必然是 --acp 路径
      const sessions = await listAgentSessions(acpCmd!)
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

  // Ctrl+C / Esc×2 由 VibeApp 接管：先删临时会话，再经 onQuit 走这里的收尾。
  // autoFocus 关闭：core 的点击聚焦会 blur 输入框，焦点权威在组件库 FocusScope
  const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false })

  // 退出前必须销毁 renderer：它负责发终端恢复序列（关鼠标追踪/退备用屏/显示光标）。
  // 直接 process.exit 会把终端留在鼠标上报模式，退出后满屏 "35;x;yM" 乱码。
  let torndown = false
  const shutdown = (code: number) => {
    if (!torndown) {
      torndown = true
      try {
        renderer.destroy()
      } catch {
        // 恢复失败也要退出
      }
    }
    process.exit(code)
  }
  process.on("SIGTERM", () => shutdown(0))
  process.on("uncaughtException", (err) => {
    if (!torndown) {
      torndown = true
      try {
        renderer.destroy()
      } catch {
        // 忽略
      }
    }
    process.stderr.write(`${err.stack ?? String(err)}\n`)
    process.exit(1)
  })

  createRoot(renderer).render(
    React.createElement(VibeApp, {
      agent: backend,
      resumeSessionId: resume || undefined,
      onQuit: () => shutdown(0),
    }),
  )
}

main().catch((err) => {
  process.stderr.write(`${(err as Error).stack ?? String(err)}\n`)
  process.exit(1)
})
