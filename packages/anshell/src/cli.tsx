import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { Anshell } from "./Anshell"

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
// --agent "<cmd...>"：可选接入 ACP agent，自然语言输入走它
const agentRaw = optionValue(argv, "--agent")
const agentCmd = agentRaw?.split(/\s+/).filter(Boolean)
// --shell /path/to/bash：统一执行、语法检查与补全语义；默认 $SHELL
const shell = optionValue(argv, "--shell")

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

createRoot(renderer).render(<Anshell agentCmd={agentCmd} shell={shell} onQuit={() => shutdown(0)} />)
