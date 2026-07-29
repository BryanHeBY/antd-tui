/**
 * repl 示例共用宿主：TTY 守卫 → 挂载 LiveView → 执行构建函数。
 * 结果输出与 engine cli 同款 NDJSON 协议：
 *   {"event":"submit","values":{...}} 退出码 0 / {"event":"cancel"} 退出码 1
 * Esc 走 LiveView 框架默认行为（与 PageView 一致）：interactive 完成回传、form 取消。
 */
import { LiveTree, LiveView, type LiveUi } from "@antd-tui/live"
import { ConfigProvider, FocusScope } from "@antd-tui/components"

export interface ExampleActions {
  /** 提交并退出（页内自绘的提交按钮用；Esc 默认完成也走同一出口） */
  submit: (values: Record<string, unknown>) => void
  /** 取消并退出 */
  cancel: () => void
}

export async function runLiveExample(
  build: ($ui: LiveUi, actions: ExampleActions) => void | Promise<void>,
): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write("repl 示例需要在真实终端（TTY）中运行\n")
    process.exit(3)
  }
  const [{ createCliRenderer }, { createRoot }] = await Promise.all([
    import("@opentui/core"),
    import("@opentui/react"),
  ])
  const tree = new LiveTree()
  // autoFocus 关闭：core 的点击聚焦会 blur 当前输入框，焦点权威在组件库 FocusScope
  const renderer = await createCliRenderer({ exitOnCtrlC: true, autoFocus: false })
  const teardown = () => {
    try {
      renderer.destroy()
    } catch {
      // 恢复失败也要退出
    }
  }
  const actions: ExampleActions = {
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
        <LiveView tree={tree} onFinish={actions.submit} onCancel={actions.cancel} />
      </FocusScope>
    </ConfigProvider>,
  )
  await build(tree.ui, actions)
}
