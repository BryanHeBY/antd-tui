/**
 * 原生 React 示例共用宿主:TTY 守卫 → 挂载纯 React 组件树。
 * 与 schema/repl 宿主同款 NDJSON 出口协议:
 *   {"event":"submit","values":{...}} 退出码 0 / {"event":"cancel"} 退出码 1
 * 这一版不经 engine(schema)也不经 live($ui):组件库就是普通 React 组件,
 * 状态、联动、校验全部用 useState/useMemo 等原生 React 手段表达。
 */
import type { ReactNode } from "react"
import { ConfigProvider, FocusScope } from "@antd-tui/components"

export interface ExampleActions {
  submit: (values: Record<string, unknown>) => void
  cancel: () => void
}

export async function runReactExample(
  build: (actions: ExampleActions) => ReactNode,
): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write("react 示例需要在真实终端（TTY）中运行\n")
    process.exit(3)
  }
  const [{ createCliRenderer }, { createRoot }] = await Promise.all([
    import("@opentui/core"),
    import("@opentui/react"),
  ])
  // autoFocus 关闭:core 的点击聚焦会 blur 当前输入框,焦点权威在组件库 FocusScope
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
      <FocusScope>{build(actions)}</FocusScope>
    </ConfigProvider>,
  )
}
