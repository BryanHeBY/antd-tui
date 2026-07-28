import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * 示例 × driver 的 E2E：以子进程跑 `--drive`，像真实用户/agent 一样
 * 通过 NDJSON 协议看帧、点击、输入，断言帧反馈与最终回传。
 * 这同时是三份黄金样例的行为回归与 driver 协议的集成验收。
 */

const CLI = join(import.meta.dir, "../src/cli.ts")
const EXAMPLES = join(import.meta.dir, "../../../examples")

interface DriveResult {
  exitCode: number
  events: Array<Record<string, unknown>>
  /** 按 id 取响应 */
  byId: (id: number) => Record<string, unknown> | undefined
  /** 最后一个协议事件（submit/cancel） */
  last: () => Record<string, unknown> | undefined
}

async function drive(
  schema: string,
  commands: Array<Record<string, unknown>>,
  size = "80x40",
): Promise<DriveResult> {
  const proc = Bun.spawn(
    ["bun", CLI, "--schema", join(EXAMPLES, schema), "--drive", "--size", size],
    {
      stdin: new TextEncoder().encode(commands.map((c) => JSON.stringify(c)).join("\n") + "\n"),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  return {
    exitCode,
    events,
    byId: (id) => events.find((e) => e.id === id),
    last: () => events.at(-1),
  }
}

describe("deploy-config × drive：填表提交全流程", () => {
  test("空表单点部署被拦（帧含校验反馈）→ 补名称改环境后提交成功", async () => {
    const r = await drive("deploy-config.schema.json", [
      // 空表单直接点部署：required 拦截；校验反馈是异步渲染，用 wait 同步。
      // 页面描述里也含「部署」二字，用按钮内的带边距文本消歧
      { id: 1, op: "click", text: "  部署  ", return: "none" },
      { id: 2, op: "wait", text: "校验未通过" },
      // 点击部署已把焦点转移到按钮（点击聚焦），先点回名称输入框（按占位文本定位）再输入
      { id: 3, op: "click", text: "如 user-api", return: "none" },
      { id: 4, op: "type", text: "user-api", return: "none" },
      // 点击 Select 的「测试」选项行切环境
      { id: 5, op: "click", text: "测试" },
      { id: 6, op: "values" },
      { id: 7, op: "click", text: "  部署  ", return: "none" },
    ])

    const blocked = r.byId(2)!
    expect(blocked.ok).toBe(true)
    expect(String(blocked.frame)).toContain("校验未通过")

    const picked = r.byId(5)!
    expect(picked.ok).toBe(true)

    expect(r.byId(6)).toMatchObject({ ok: true, values: { name: "user-api", env: "test" } })

    // 提交成功：submit 事件穿透，进程退出码 0，回传含全部用户输入
    expect(r.exitCode).toBe(0)
    expect(r.last()).toMatchObject({
      event: "submit",
      values: { name: "user-api", env: "test", port: 8080, region: "cn-north" },
    })
  })

  test("点击开关展开高级配置：帧里出现联动区域", async () => {
    const r = await drive(
      "deploy-config.schema.json",
      [
        { id: 1, op: "locate", text: "CPU 上限" },
        { id: 2, op: "click", text: "关" },
        { id: 3, op: "quit" },
      ],
      "80x52",
    )
    // 展开前定位不到高级区，展开后出现
    expect(r.byId(1)).toMatchObject({ ok: false })
    const toggled = r.byId(2)!
    expect(toggled.ok).toBe(true)
    expect(String(toggled.frame)).toContain("CPU 上限")
    expect(String(toggled.frame)).toContain("崩溃后自动重启")
    expect(r.exitCode).toBe(1)
    expect(r.last()).toMatchObject({ event: "cancel" })
  })
})

describe("service-dashboard × drive：展示页交互", () => {
  test("加负载/切服务的帧联动，Esc 回传空对象", async () => {
    const r = await drive(
      "service-dashboard.schema.json",
      [
        { id: 1, op: "snapshot" },
        { id: 2, op: "click", text: "负载 +10" },
        { id: 3, op: "click", text: "2 user-api" },
        { id: 4, op: "press", key: "escape" },
      ],
      "80x50",
    )

    const first = String(r.byId(1)!.frame)
    expect(first).toContain("服务监控面板")
    expect(first).toContain("请求量")
    expect(first).toContain("42%")

    // $state 联动：负载 +10 后帧变 52%
    expect(String(r.byId(2)!.frame)).toContain("52%")
    // 切服务：Descriptions 标题与内容联动
    const detail = String(r.byId(3)!.frame)
    expect(detail).toContain("user-api 详情")
    expect(detail).toContain("v1.9.0")

    // interactive 模式 Esc 完成：$state 与展示数据不回传
    expect(r.exitCode).toBe(0)
    expect(r.last()).toMatchObject({ event: "submit", values: {} })
  })
})

describe("calculator × drive：键盘流与热键", () => {
  test("type 表达式 + 等号求值 + backspace 退格", async () => {
    const r = await drive(
      "calculator.schema.json",
      [
        { id: 1, op: "type", text: "12+34*5" },
        { id: 2, op: "press", key: "=" },
        { id: 3, op: "values" },
        // 结果 182 上按退格 → 18
        { id: 4, op: "press", key: "backspace" },
        { id: 5, op: "values" },
        { id: 6, op: "press", key: "escape" },
      ],
      "60x28",
    )

    expect(String(r.byId(1)!.frame)).toContain("12+34×5")
    expect(r.byId(3)).toMatchObject({ ok: true, values: { display: "182" } })
    expect(r.byId(5)).toMatchObject({ ok: true, values: { display: "18" } })
    expect(r.exitCode).toBe(0)
    expect(r.last()).toMatchObject({ event: "submit", values: { display: "18" } })
  })

  test("locate 与坐标点击等价：定位 AC 后按坐标点击复位", async () => {
    const r = await drive(
      "calculator.schema.json",
      [
        { id: 1, op: "type", text: "99", return: "none" },
        { id: 2, op: "locate", text: "AC" },
        { id: 3, op: "values" },
      ],
      "60x28",
    )
    const pos = r.byId(2)!
    expect(pos.ok).toBe(true)

    // 用上一步返回的坐标继续第二段会话（协议无状态，坐标可复用）
    const r2 = await drive(
      "calculator.schema.json",
      [
        { id: 1, op: "type", text: "99", return: "none" },
        { id: 2, op: "click", x: pos.x as number, y: pos.y as number },
        { id: 3, op: "values" },
        { id: 4, op: "quit" },
      ],
      "60x28",
    )
    expect(r.byId(3)).toMatchObject({ values: { display: "99" } })
    expect(r2.byId(3)).toMatchObject({ values: { display: "0" } })
    expect(r2.exitCode).toBe(1)
  })
})
