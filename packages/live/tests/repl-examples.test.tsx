import { describe, expect, test } from "bun:test"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope, displayWidth } from "@antd-tui/components"
import { buildCalculator } from "../../../examples/repl/calculator"
import { buildDeployConfig } from "../../../examples/repl/deploy-config"
import { buildServiceDashboard } from "../../../examples/repl/service-dashboard"
import type { ExampleActions } from "../../../examples/repl/host"
import { LiveTree } from "../src/tree"
import { LiveView } from "../src/LiveView"

/**
 * 三个 REPL 示例的冒烟验收（真函数闭包逻辑闭环），
 * 顺带把 examples/repl/*.tsx 纳入 typecheck 与 CI。
 */

function locate(frame: string, target: string): { x: number; y: number } {
  const lines = frame.split("\n")
  for (let y = 0; y < lines.length; y++) {
    const idx = lines[y]!.indexOf(target)
    if (idx >= 0) {
      const x = displayWidth(lines[y]!.slice(0, idx))
      return { x: x + Math.floor(displayWidth(target) / 2), y }
    }
  }
  throw new Error(`帧中找不到 "${target}"`)
}

async function mount(tree: LiveTree, height = 26) {
  return renderTui(
    <ConfigProvider>
      <FocusScope>
        <LiveView tree={tree} hideHint />
      </FocusScope>
    </ConfigProvider>,
    { width: 70, height },
  )
}

async function click(t: TuiTestSetup, label: string) {
  const pos = locate(t.frame(), label)
  await t.raw.mockMouse.click(pos.x, pos.y)
  await t.settle()
}

describe("examples/repl", () => {
  test("calculator：点击 7 + 8 = 得 15", async () => {
    const tree = new LiveTree()
    const t = await mount(tree)

    buildCalculator(tree.ui)
    await t.waitUntil(() => t.frame().includes("TUI 计算器（REPL 版）"), 8000)

    await click(t, "7")
    await click(t, "+")
    await click(t, "8")
    await click(t, "=")
    expect(t.frame()).toContain("15")

    t.destroy()
  }, 20000)

  test("deploy-config：校验错误上屏，开关联动插删高级卡片，提交回传", async () => {
    const tree = new LiveTree()
    const t = await mount(tree, 40)
    const submits: unknown[] = []
    const actions: ExampleActions = {
      submit: (values) => submits.push(values),
      cancel: () => {},
    }

    buildDeployConfig(tree.ui, actions)
    await t.waitUntil(() => t.frame().includes("基础信息"), 8000)

    // 空名称提交：校验失败写回 FormItem，不回传
    await click(t, "  部署  ")
    expect(t.frame()).toContain("服务名称必填")
    expect(submits.length).toBe(0)

    // 开关联动：advanced 打开插入高级卡片，关闭删除
    tree.ui.data.advanced = true
    await t.settle()
    expect(t.frame()).toContain("高级配置")
    tree.ui.data.advanced = false
    await t.settle()
    expect(t.frame()).not.toContain("CPU 上限")

    // 合法提交
    tree.ui.data.name = "user-api"
    await click(t, "  部署  ")
    expect(submits.length).toBe(1)
    expect(submits[0]).toMatchObject({ name: "user-api", env: "dev", port: 8080 })

    t.destroy()
  }, 20000)

  test("service-dashboard：负载联动 Progress，切换服务联动详情", async () => {
    const tree = new LiveTree()
    const t = await mount(tree, 40)

    buildServiceDashboard(tree.ui)
    await t.waitUntil(() => t.frame().includes("服务监控面板（REPL 版）"), 8000)
    expect(t.frame()).toContain("42%")
    expect(t.frame()).toContain("gateway 详情")

    await click(t, "负载 +10")
    expect(t.frame()).toContain("52%")

    await click(t, "2 user-api")
    expect(t.frame()).toContain("user-api 详情")
    expect(t.frame()).toContain("node-02")

    t.destroy()
  }, 20000)
})
