import { describe, expect, test } from "bun:test"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { displayWidth } from "../src/width"
import { ConfigProvider } from "../src/theme"
import { FocusScope } from "../src/focus"
import { Calculator } from "../../../examples/react/calculator"
import { Dashboard } from "../../../examples/react/dashboard"

/**
 * 原生 React 示例冒烟:组件库当普通 React 组件用的第三种形态,
 * 顺带把 examples/react/*.tsx 纳入 typecheck 与 CI。
 */

function locate(frame: string, target: string): { x: number; y: number } {
  const lines = frame.split("\n")
  let found: { x: number; y: number } | null = null
  for (let y = 0; y < lines.length; y++) {
    const idx = lines[y]!.indexOf(target)
    if (idx >= 0) {
      const x = displayWidth(lines[y]!.slice(0, idx))
      found = { x: x + Math.floor(displayWidth(target) / 2), y }
    }
  }
  if (!found) throw new Error(`帧中找不到 "${target}"`)
  return found
}

async function click(t: TuiTestSetup, label: string) {
  const pos = locate(t.frame(), label)
  await t.click(pos.x, pos.y)
}

describe("examples/react", () => {
  test("calculator:点击 7 + 8 = 得 15", async () => {
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Calculator />
        </FocusScope>
      </ConfigProvider>,
      { width: 70, height: 26 },
    )
    await t.waitUntil(() => t.frame().includes("TUI 计算器（React 版）"), 8000)
    await click(t, "7")
    await click(t, "+")
    await click(t, "8")
    await click(t, "=")
    expect(t.frame()).toContain("15")
    t.destroy()
  }, 20000)

  test("dashboard:登录 → shell 导航 → 条件渲染联动 → 校验", async () => {
    let submitted: Record<string, unknown> | null = null
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Dashboard
            actions={{ submit: (v) => (submitted = v), cancel: () => {} }}
          />
        </FocusScope>
      </ConfigProvider>,
      { width: 90, height: 40 },
    )
    await t.waitUntil(() => t.frame().includes("登录"), 8000)

    // 空提交拦截
    await click(t, "登 录")
    await t.waitUntil(() => t.frame().includes("用户名与密码不能为空"), 4000)

    // 点击空提交后焦点在按钮上:分别点回两个输入框填值,再点登录
    await click(t, "ops-admin")
    await t.type("admin")
    await click(t, "任意非空")
    await t.type("secret")
    await click(t, "登 录")
    await t.waitUntil(() => t.frame().includes("节点负载"), 8000)

    // 导航热键 + 条件渲染
    await t.type("2")
    await t.waitUntil(() => t.frame().includes("gateway 详情"), 4000)
    await t.type("4")
    await t.waitUntil(() => t.frame().includes("部署配置"), 4000)
    expect(t.frame()).not.toContain("CPU 上限")

    // 空名称部署:校验错误经 FormItem 上屏,不回传
    await click(t, "  部署  ")
    await t.waitUntil(() => t.frame().includes("服务名称必填"), 4000)
    expect(submitted).toBeNull()
    t.destroy()
  }, 20000)
})
