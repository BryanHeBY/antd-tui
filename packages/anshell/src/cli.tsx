import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Anshell } from "./Anshell"
import { resolveShellDialect, unsupportedShellMessage } from "./shell"
import type { AgentBackend } from "@antd-tui/pi-agent"
import { buildPiRuntime, PI_EFFORTS, type PiEffort } from "@antd-tui/pi-agent"

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  process.stderr.write("ansh 需要在真实终端（TTY）中运行\n")
  process.exit(3)
}

function optionValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  return argv[i + 1] || undefined
}

const argv = process.argv.slice(2)
// --acp "<cmd...>"：显式 ACP agent 子进程。缺省 = pi 原生后端——
// 模型/effort/凭据来自 --config 文件（覆盖链 --model/--effort > PI_MODEL/PI_EFFORT > 配置）。
const acpRaw = optionValue(argv, "--acp")
const acpCmd = acpRaw?.split(/\s+/).filter(Boolean)
const configPath = optionValue(argv, "--config")
const modelFlag = optionValue(argv, "--model")
const effortFlag = optionValue(argv, "--effort")

function resolveAgent(): AgentBackend | undefined {
  if (acpCmd) return { kind: "acp", cmd: acpCmd }
  if (effortFlag !== undefined && !PI_EFFORTS.includes(effortFlag as PiEffort)) {
    process.stderr.write(`--effort 应为 ${PI_EFFORTS.join("/")}\n`)
    process.exit(2)
  }
  try {
    return {
      kind: "pi",
      spec: modelFlag,
      config: configPath,
      effort: effortFlag as PiEffort | undefined,
      runtime: buildPiRuntime({
        configPath,
        model: modelFlag,
        effort: effortFlag as PiEffort | undefined,
      }),
    }
  } catch (err) {
    // shell 是主角：默认 pi 解析不出模型时降级为无 agent，stderr 提示一句，不进 TUI 打扰
    process.stderr.write(`pi agent 未启用：${(err as Error).message}\n`)
    return undefined
  }
}

const agent = resolveAgent()
const shell = optionValue(argv, "--shell")
// --no-rc：不 source 用户 dotfiles（干净环境）
const shellInit = argv.includes("--no-rc") ? "minimal" : "user"

// 不支持的 shell 必须在建 renderer（进 alt-screen）之前报错，否则收尾会把错误刷掉
const resolved = resolveShellDialect(shell)
if (resolved.dialect === null) {
  process.stderr.write(unsupportedShellMessage(resolved.path) + "\n")
  process.exit(2)
}

// Ctrl-C 由 Anshell 接管（中断在跑的命令）；退出走 Ctrl-D / exit
const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false })

let torndown = false
const shutdown = (code: number) => {
  if (torndown) return
  torndown = true
  try {
    renderer.destroy()
  } catch {
    /* 恢复失败也要退出 */
  }
  process.exit(code)
}

process.on("SIGTERM", () => shutdown(0))
process.on("uncaughtException", (err) => {
  try {
    renderer.destroy()
  } catch {
    /* ignore */
  }
  process.stderr.write(`uncaughtException: ${err.message}\n`)
  process.exit(1)
})

createRoot(renderer).render(
  <Anshell agent={agent} shell={shell} shellInit={shellInit} onQuit={() => shutdown(0)} />,
)
