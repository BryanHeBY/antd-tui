import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { ConfigProvider, FocusScope, Typography } from "@antd-tui/components"
import { Anterm } from "./Anterm"

if (!process.stdout.isTTY || !process.stdin.isTTY) {
  process.stderr.write("anterm 需要在真实终端（TTY）中运行\n")
  process.exit(3)
}

const [command = process.env.SHELL ?? "bash", ...args] = process.argv.slice(2)

// Ctrl-C 必须透传给子进程，不能由宿主渲染器接走
const renderer = await createCliRenderer({ exitOnCtrlC: false, autoFocus: false })

const teardown = () => {
  try {
    renderer.destroy()
  } catch {
    /* 恢复失败也要退出 */
  }
}

process.on("SIGTERM", () => {
  teardown()
  process.exit(0)
})
process.on("uncaughtException", (err) => {
  teardown()
  process.stderr.write(`uncaughtException: ${err.message}\n`)
  process.exit(1)
})

function Demo() {
  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", padding: 1 }}>
      <Typography.Text type="secondary">
        {`${command} ${args.join(" ")}　—　Ctrl+] 交还焦点`}
      </Typography.Text>
      <Anterm
        command={command}
        args={args}
        autoFocus
        style={{ flexGrow: 1, marginTop: 1 }}
        onExit={() => {
          teardown()
          process.exit(0)
        }}
      />
    </box>
  )
}

createRoot(renderer).render(
  <ConfigProvider>
    <FocusScope>
      <Demo />
    </FocusScope>
  </ConfigProvider>,
)
