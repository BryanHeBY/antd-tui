import { describe, expect, test } from "bun:test"
import { renderTui } from "@antd-tui/test-utils"
import { App } from "../src/App"
import type { PageSchema } from "../src/validate"
import deploySchema from "../../../examples/deploy-config.schema.json"
import dashboardSchema from "../../../examples/service-dashboard.schema.json"

/**
 * E2E（进程内）：deploy-config（form 模式全录入组件 + x-reactions 显隐 + 校验）
 * 与 service-dashboard（interactive 模式全展示组件 + 表达式 props 响应性）。
 */

function render(
  schema: PageSchema,
  onFinish: (v: Record<string, unknown>) => void = () => {},
  onCancel: () => void = () => {},
) {
  // 视口须容纳页面自然高度：内容超高时 flex 压缩会导致行重叠
  return renderTui(<App schema={schema} onFinish={onFinish} onCancel={onCancel} />, {
    width: 80,
    height: 52,
  })
}

/** 在字符帧中找目标文本坐标（用于鼠标点击）；页面标题也含「部署」，按钮定位用带边距的「 部署 」 */
function locate(frame: string, target: string): { x: number; y: number } {
  const lines = frame.split("\n")
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(target)
    if (x >= 0) return { x, y }
  }
  throw new Error(`帧中找不到 "${target}"`)
}

/** 点击「部署」提交按钮（Button 渲染为带边框、文案两侧留空的方框） */
async function clickDeploy(t: Awaited<ReturnType<typeof render>>) {
  const pos = locate(t.frame(), " 部署 ")
  await t.raw.mockMouse.click(pos.x + 2, pos.y)
  await t.settle()
}

describe("deploy-config E2E", () => {
  const schema = deploySchema as unknown as PageSchema

  test("初始渲染：基础组件齐全，高级配置默认隐藏，自定义 actions 文案", async () => {
    const t = await render(schema)

    const frame = t.frame()
    expect(frame).toContain("服务部署配置")
    expect(frame).toContain("基础信息")
    expect(frame).toContain("服务名称")
    expect(frame).toContain("部署环境")
    expect(frame).toContain("部署地域")
    expect(frame).toContain("附加能力")
    expect(frame).toContain("启用高级配置")
    // 自定义 actions 文案
    expect(frame).toContain("部署")
    expect(frame).toContain("取消")
    // x-reactions：advanced 默认 false，高级配置卡片不渲染
    expect(frame).not.toContain("CPU 上限")
    expect(frame).not.toContain("启动脚本")
    t.destroy()
  })

  test("advanced 默认 true 时高级配置可见（x-reactions 表达式生效）", async () => {
    const withAdvanced = structuredClone(deploySchema) as unknown as PageSchema
    const props = (withAdvanced.form as { properties: Record<string, { default?: unknown }> })
      .properties
    props.advanced!.default = true
    const t = await render(withAdvanced)

    await t.waitUntil(() => t.frame().includes("CPU 上限"))
    const frame = t.frame()
    expect(frame).toContain("高级配置")
    expect(frame).toContain("启动脚本")
    expect(frame).toContain("崩溃后自动重启")
    t.destroy()
  })

  test("空表单提交：required 与校验拦截，错误信息上屏", async () => {
    let finished: Record<string, unknown> | null = null
    const t = await render(schema, (v) => (finished = v))

    await clickDeploy(t)
    // required 校验失败：不回传、错误信息渲染在 FormItem 下
    expect(finished).toBeNull()
    await t.waitUntil(() => /必填|required/.test(t.frame()))
    t.destroy()
  })

  test("非法服务名提交被 x-validator pattern 拦截", async () => {
    let finished: Record<string, unknown> | null = null
    const t = await render(schema, (v) => (finished = v))

    // 首个 focusable 是服务名称 Input，直接输入非法值
    await t.type("User_API")
    await t.waitUntil(() => t.frame().includes("User_API"))
    await clickDeploy(t)
    expect(finished).toBeNull()
    await t.waitUntil(() => t.frame().includes("仅允许小写字母"))
    t.destroy()
  })
})

describe("service-dashboard E2E", () => {
  const schema = dashboardSchema as unknown as PageSchema

  test("初始渲染：展示组件齐全", async () => {
    const t = await render(schema)

    const frame = t.frame()
    expect(frame).toContain("服务监控面板")
    expect(frame).toContain("例行维护")
    expect(frame).toContain("SLA 达标")
    expect(frame).toContain("请求量")
    expect(frame).toContain("错误率")
    expect(frame).toContain("节点负载")
    expect(frame).toContain("gateway 详情")
    expect(frame).toContain("v2.4.1")
    expect(frame).toContain("实例列表")
    expect(frame).toContain("i-01")
    // interactive 模式：无操作栏
    expect(frame).not.toContain("提交")
    t.destroy()
  })

  test("热键 +/-：Progress percent 随 $state 联动", async () => {
    const t = await render(schema)

    expect(t.frame()).toContain("42%")
    await t.type("+")
    await t.waitUntil(() => t.frame().includes("52%"))
    await t.type("-")
    await t.type("-")
    await t.waitUntil(() => t.frame().includes("32%"))
    t.destroy()
  })

  test("热键 2 切换服务：Descriptions 标题与 items 联动", async () => {
    const t = await render(schema)

    await t.type("2")
    await t.waitUntil(() => t.frame().includes("user-api 详情"))
    expect(t.frame()).toContain("v1.9.0")
    await t.type("3")
    await t.waitUntil(() => t.frame().includes("billing 详情"))
    t.destroy()
  })

  test("热键 r 刷新：Spin 出现后自动消失", async () => {
    const t = await render(schema)

    await t.type("r")
    await t.waitUntil(() => t.frame().includes("刷新中"))
    await t.waitUntil(() => !t.frame().includes("刷新中"))
    t.destroy()
  })

  test("Esc 回传：$state/展示数据不混入，只回传用户输入", async () => {
    let finished: Record<string, unknown> | null = null
    const t = await render(schema, (v) => (finished = v))

    await t.type("+")
    await t.escape()
    await t.waitUntil(() => finished !== null)
    // dashboard 无任何用户输入字段：$state（current/cpu/loading）与静态展示值都不应回传
    expect(finished!).toEqual({})
    t.destroy()
  })
})
