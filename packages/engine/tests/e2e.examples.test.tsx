import { describe, expect, test } from "bun:test"
import { renderTui } from "@antd-tui/test-utils"
import { App } from "../src/App"
import type { PageSchema } from "../src/validate"
import dashboardSchema from "../../../examples/schema/dashboard.json"

/**
 * E2E（进程内）：dashboard 示例——登录页（x-visible 整页切换、Button loading 表达式）
 * + App Shell（$state 驱动导航/表达式 props/x-reactions 显隐/x-validator 校验）。
 */

function render(
  schema: PageSchema,
  onFinish: (v: Record<string, unknown>) => void = () => {},
  onCancel: () => void = () => {},
) {
  // 视口须容纳页面自然高度：内容超高时 flex 压缩会导致行重叠
  return renderTui(<App schema={schema} onFinish={onFinish} onCancel={onCancel} />, {
    width: 90,
    height: 52,
  })
}

/** 取最后一次出现:表格/列表里的同名文本在上方,可点击按钮通常在下方 */
function locate(frame: string, target: string): { x: number; y: number } {
  const lines = frame.split("\n")
  let found: { x: number; y: number } | null = null
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(target)
    if (x >= 0) found = { x, y }
  }
  if (!found) throw new Error(`帧中找不到 "${target}"`)
  return found
}

async function click(t: Awaited<ReturnType<typeof render>>, target: string, dx = 2) {
  const pos = locate(t.frame(), target)
  await t.click(pos.x + dx, pos.y)
}

/** 登录进 shell：登录页无必填校验（声明式版），直接点登录 */
async function login(t: Awaited<ReturnType<typeof render>>) {
  await click(t, "登 录")
  await t.waitUntil(() => t.frame().includes("节点负载"), 8000)
}

describe("dashboard E2E", () => {
  const schema = dashboardSchema as unknown as PageSchema

  test("初始为登录页：shell 经 x-visible 隐藏；登录后整页切换", async () => {
    const t = await render(schema)

    const frame = t.frame()
    expect(frame).toContain("登录")
    expect(frame).toContain("记住我")
    expect(frame).toContain("忘记密码")
    // shell 尚不可见
    expect(frame).not.toContain("节点负载")

    await login(t)
    const after = t.frame()
    expect(after).toContain("☰")
    expect(after).toContain("1  概览")
    expect(after).toContain("请求量")
    expect(after).toContain("集群信息")
    expect(after).toContain("更新于 10:24")
    t.destroy()
  }, 20000)

  test("概览：热键 +/- 驱动 $state，Progress 联动", async () => {
    const t = await render(schema)
    await login(t)

    expect(t.frame()).toContain("42%")
    await t.type("+")
    await t.waitUntil(() => t.frame().includes("52%"))
    await t.type("-")
    await t.type("-")
    await t.waitUntil(() => t.frame().includes("32%"))
    t.destroy()
  }, 20000)

  test("服务页：切换按钮驱动 Descriptions 表达式重算", async () => {
    const t = await render(schema)
    await login(t)

    await t.type("2")
    await t.waitUntil(() => t.frame().includes("gateway 详情"))
    expect(t.frame()).toContain("v2.4.1")
    await click(t, " user-api ")
    await t.waitUntil(() => t.frame().includes("user-api 详情"))
    expect(t.frame()).toContain("v1.9.0")
    t.destroy()
  }, 20000)

  test("设置页：x-reactions 显隐高级卡 + x-validator 校验反馈", async () => {
    const t = await render(schema)
    await login(t)

    await t.type("4")
    await t.waitUntil(() => t.frame().includes("部署配置"))
    expect(t.frame()).not.toContain("CPU 上限")
    // 打开高级开关：x-reactions 让高级配置卡出现
    await click(t, "● 关", 1)
    await t.waitUntil(() => t.frame().includes("CPU 上限"))
    expect(t.frame()).toContain("崩溃后自动重启")

    // 非法服务名：x-validator pattern 实时反馈
    await click(t, "如 user-api")
    await t.type("User_API")
    await t.waitUntil(() => t.frame().includes("仅允许小写字母"))
    t.destroy()
  }, 20000)

  test("热键 r 刷新：Spin 出现后自动消失", async () => {
    const t = await render(schema)
    await login(t)

    await t.type("r")
    await t.waitUntil(() => t.frame().includes("刷新中"))
    await t.waitUntil(() => !t.frame().includes("刷新中"))
    t.destroy()
  }, 20000)
})
