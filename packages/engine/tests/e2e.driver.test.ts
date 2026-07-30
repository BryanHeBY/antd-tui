import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * 示例 × driver 的 E2E：以子进程跑 `--drive`，像真实用户/agent 一样
 * 通过 NDJSON 协议看帧、点击、输入，断言帧反馈与最终回传。
 * 这同时是黄金样例的行为回归与 driver 协议的集成验收。
 */

const CLI = join(import.meta.dir, "../src/cli.ts")
const EXAMPLES = join(import.meta.dir, "../../../examples/schema")

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

describe("dashboard × drive：登录 → shell 交互全流程", () => {
  test("登录进 shell，加负载联动，Esc 回传表单默认值", async () => {
    const r = await drive(
      "dashboard.json",
      [
        { id: 1, op: "snapshot" },
        { id: 2, op: "click", text: "登 录" },
        { id: 3, op: "wait", text: "节点负载" },
        { id: 4, op: "click", text: "负载 +10" },
        // x-visible 隐藏的字段值会被 formily 摘除:切到设置页让表单字段可见再 Esc
        { id: 5, op: "press", key: "4" },
        { id: 6, op: "wait", text: "部署配置" },
        { id: 7, op: "press", key: "escape" },
      ],
      "90x50",
    )

    const first = String(r.byId(1)!.frame)
    expect(first).toContain("登录")
    expect(first).toContain("记住我")
    expect(first).not.toContain("节点负载")

    expect(r.byId(3)).toMatchObject({ ok: true })
    // $state 联动：负载 +10 后帧变 52%
    expect(String(r.byId(4)!.frame)).toContain("52%")

    // interactive Esc 完成：回传当前可见分区的表单默认值；
    // 登录页与其他 x-visible 隐藏分区的字段值被 formily 摘除，$state 不混入
    expect(r.exitCode).toBe(0)
    expect(r.last()).toMatchObject({
      event: "submit",
      values: { env: "dev", port: 8080, region: "cn-north", advanced: false },
    })
  })

  test("设置页：x-validator 实时校验 + x-reactions 展开高级卡", async () => {
    const r = await drive(
      "dashboard.json",
      [
        { id: 1, op: "click", text: "登 录" },
        { id: 2, op: "wait", text: "节点负载" },
        { id: 3, op: "press", key: "4" },
        { id: 4, op: "wait", text: "部署配置" },
        { id: 5, op: "locate", text: "CPU 上限" },
        { id: 6, op: "click", text: "如 user-api" },
        { id: 7, op: "type", text: "User_API" },
        { id: 8, op: "wait", text: "仅允许小写字母" },
        { id: 9, op: "quit" },
      ],
      "90x52",
    )

    expect(r.byId(4)).toMatchObject({ ok: true })
    // 展开前定位不到高级卡
    expect(r.byId(5)).toMatchObject({ ok: false })
    // x-validator pattern 实时反馈
    expect(r.byId(8)).toMatchObject({ ok: true })
    expect(r.exitCode).toBe(1)
    expect(r.last()).toMatchObject({ event: "cancel" })
  })
})

describe("calculator × drive：键盘流与热键", () => {
  test("type 表达式 + 等号求值 + backspace 退格", async () => {
    const r = await drive(
      "calculator.json",
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
      "calculator.json",
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
      "calculator.json",
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
