import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { Antop } from "./Antop"
import type { AntopActions } from "./types"

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  process.stderr.write("antop 需要在真实终端（TTY）中运行\n")
  process.exit(3)
}

const renderer = await createCliRenderer({ exitOnCtrlC: true, autoFocus: false })

const teardown = () => {
  try { renderer.destroy() } catch { /* 恢复失败也要退出 */ }
}

process.on("SIGTERM", () => { teardown(); process.exit(0) })
process.on("uncaughtException", (err) => {
  teardown()
  process.stderr.write(`uncaughtException: ${err.message}\n`)
  process.exit(1)
})

const actions: AntopActions = {
  submit: (values) => {
    teardown()
    process.stdout.write(JSON.stringify({ event: "submit", values }) + "\n")
    process.exit(0)
  },
  cancel: () => {
    teardown()
    process.stdout.write(JSON.stringify({ event: "cancel" }) + "\n")
    process.exit(1)
  },
}

createRoot(renderer).render(
  <ConfigProvider>
    <FocusScope>
      <Antop actions={actions} />
    </FocusScope>
  </ConfigProvider>,
)
