import { describe, expect, test } from "bun:test"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope, displayWidth } from "@antd-tui/components"
import { buildCalculator } from "../../../examples/repl/calculator"
import { buildDashboard } from "../../../examples/repl/dashboard"
import type { ExampleActions } from "../../../examples/repl/host"
import { LiveTree } from "../src/tree"
import { LiveView } from "../src/LiveView"

/**
 * REPL 示例的冒烟验收（真函数闭包逻辑闭环），
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
  await t.click(pos.x, pos.y)
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

  test("dashboard：登录 → App Shell 导航 + 动态详情 + 校验表单", async () => {
    const tree = new LiveTree()
    const t = await mount(tree, 40)

    buildDashboard(tree.ui)
    // 登录页:空提交被拦,补全后进 shell($ui.clear() 整页重建)
    await t.waitUntil(() => t.frame().includes("登录"), 8000)
    await click(t, "登 录")
    await t.waitUntil(() => t.frame().includes("用户名与密码不能为空"), 4000)
    tree.data.user = "admin"
    tree.data.pass = "secret"
    await click(t, "登 录")
    await t.waitUntil(() => t.frame().includes("节点负载"), 8000)
    expect(t.frame()).toContain("集群信息")

    // 服务页:切换按钮驱动 Descriptions 重算(源自 service-dashboard)
    await click(t, "2  服务")
    expect(t.frame()).toContain("gateway 详情")
    expect(t.frame()).toContain("v2.4.1")
    // "user-api" 也出现在上方表格行里,按钮在页面下方——取最后一次出现的位置点击
    {
      const lines = t.frame().split("\n")
      let pos: { x: number; y: number } | null = null
      for (let y = 0; y < lines.length; y++) {
        const idx = lines[y]!.indexOf("user-api")
        if (idx >= 0) {
          const x = displayWidth(lines[y]!.slice(0, idx))
          pos = { x: x + Math.floor(displayWidth("user-api") / 2), y }
        }
      }
      await t.click(pos!.x, pos!.y)
    }
    await t.waitUntil(() => t.frame().includes("user-api 详情"), 4000)
    expect(t.frame()).toContain("v1.9.0")

    await click(t, "3  告警")
    expect(t.frame()).toContain("全部确认")
    await click(t, "全部确认")
    expect(t.frame()).toContain("暂无未确认告警")

    // 设置页:watch 联动插删高级卡 + 校验写回(源自 deploy-config)
    await click(t, "4  设置")
    expect(t.frame()).toContain("部署配置")
    expect(t.frame()).not.toContain("CPU 上限")
    tree.data.advanced = true
    await t.settle()
    expect(t.frame()).toContain("CPU 上限")
    tree.data.advanced = false
    await t.settle()
    expect(t.frame()).not.toContain("CPU 上限")

    // 空名称点部署:校验拦截,错误写回 FormItem
    await click(t, "  部署  ")
    await t.waitUntil(() => t.frame().includes("服务名称必填"), 4000)

    // 切走再切回:watch 经分区清理不重复注册,表单值保留
    await click(t, "1  概览")
    await click(t, "4  设置")
    expect(tree.data.port).toBe(8080)

    t.destroy()
  }, 20000)

})
