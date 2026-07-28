import { describe, expect, test } from "bun:test"
import { join } from "node:path"

/**
 * E2E（跨进程）：以子进程方式跑真实 CLI，验证输入方式、校验协议与退出码。
 * TUI 交互路径（需要 TTY）由 e2e.app.test.tsx 进程内覆盖，
 * 这里覆盖 agent 视角的进程契约。
 */

const CLI = join(import.meta.dir, "../src/cli.ts")
const CALC_SCHEMA = join(import.meta.dir, "../../../examples/calculator.schema.json")

interface RunResult {
  exitCode: number
  stdout: string
  events: Array<Record<string, unknown>>
}

async function runCli(args: string[], stdin?: string): Promise<RunResult> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdin: stdin !== undefined ? new TextEncoder().encode(stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const stdout = await new Response(proc.stdout).text()
  const exitCode = await proc.exited
  // snapshot 模式 stdout 是原始内容而非 NDJSON，非 JSON 行跳过
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        return []
      }
    })
  return { exitCode, stdout, events }
}

describe("CLI 协议", () => {
  test("--schema --dry-run：合法 schema 返回 valid，退出码 0", async () => {
    const r = await runCli(["--schema", CALC_SCHEMA, "--dry-run"])
    expect(r.exitCode).toBe(0)
    expect(r.events).toEqual([{ event: "valid" }])
  })

  test("--stdin --dry-run：从管道读 schema", async () => {
    const text = await Bun.file(CALC_SCHEMA).text()
    const r = await runCli(["--stdin", "--dry-run"], text)
    expect(r.exitCode).toBe(0)
    expect(r.events).toEqual([{ event: "valid" }])
  })

  test("白名单外组件：invalid 事件带 JSON 路径，退出码 2", async () => {
    const bad = JSON.stringify({
      version: "0.1",
      form: { type: "object", properties: { x: { "x-component": "Evil" } } },
    })
    const r = await runCli(["--schema-json", bad, "--dry-run"])
    expect(r.exitCode).toBe(2)
    expect(r.events[0]?.event).toBe("invalid")
    expect(String((r.events[0]?.errors as string[])[0])).toContain("/form/properties/x/x-component")
  })

  test("非法 JSON：invalid，退出码 2", async () => {
    const r = await runCli(["--schema-json", "{not json", "--dry-run"])
    expect(r.exitCode).toBe(2)
    expect(r.events[0]?.event).toBe("invalid")
  })

  test("缺少输入源：error，退出码 2", async () => {
    const r = await runCli(["--dry-run"])
    expect(r.exitCode).toBe(2)
    expect(r.events[0]?.event).toBe("error")
  })

  test("非 TTY 下渲染：error，退出码 3", async () => {
    const r = await runCli(["--schema", CALC_SCHEMA])
    expect(r.exitCode).toBe(3)
    expect(r.events[0]?.event).toBe("error")
    expect(String(r.events[0]?.message)).toContain("TTY")
  })

  test("--stdin 非 dry-run 渲染：stdin 是管道时明确报错，退出码 3", async () => {
    const text = await Bun.file(CALC_SCHEMA).text()
    const r = await runCli(["--stdin"], text)
    expect(r.exitCode).toBe(3)
    expect(r.events[0]?.event).toBe("error")
    expect(String(r.events[0]?.message)).toContain("--stdin")
  })

  test("--check：合法 schema 无头渲染通过，退出码 0（无需 TTY）", async () => {
    const r = await runCli(["--schema", CALC_SCHEMA, "--check"])
    expect(r.exitCode).toBe(0)
    expect(r.events).toEqual([{ event: "valid" }])
  })

  test("--check：表达式运行时崩溃被捕获为 invalid，退出码 2", async () => {
    const bad = JSON.stringify({
      version: "0.1",
      form: {
        type: "object",
        properties: {
          t: {
            type: "void",
            "x-component": "Descriptions",
            "x-component-props": { items: "{{ $form.values.nothing.map((x) => x) }}" },
          },
        },
      },
    })
    const r = await runCli(["--schema-json", bad, "--check"])
    expect(r.exitCode).toBe(2)
    expect(r.events[0]?.event).toBe("invalid")
    expect(String((r.events[0]?.errors as string[])[0])).toContain("渲染期异常")
  })
})

describe("--snapshot 帧导出", () => {
  test("text：输出字符画到 stdout，退出码 0", async () => {
    const r = await runCli(["--schema", CALC_SCHEMA, "--snapshot", "--size", "60x28"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("TUI 计算器")
    expect(r.stdout).toContain("AC")
  })

  test("ansi：包含 24 位色转义序列", async () => {
    const r = await runCli([
      "--schema",
      CALC_SCHEMA,
      "--snapshot",
      "--format",
      "ansi",
      "--size",
      "60x28",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("\x1b[38;2;")
  })

  test("svg：输出等宽网格矢量图", async () => {
    const r = await runCli([
      "--schema",
      CALC_SCHEMA,
      "--snapshot",
      "--format",
      "svg",
      "--size",
      "60x28",
    ])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("<svg xmlns=")
    expect(r.stdout).toContain("</svg>")
  })

  test("非法 format 报错，退出码 2", async () => {
    const r = await runCli(["--schema", CALC_SCHEMA, "--snapshot", "--format", "png"])
    expect(r.exitCode).toBe(2)
    expect(r.events[0]?.event).toBe("error")
  })

  test("零尺寸被拒绝，避免传给渲染器", async () => {
    const r = await runCli(["--schema", CALC_SCHEMA, "--snapshot", "--size", "0x24"])
    expect(r.exitCode).toBe(2)
    expect(r.events[0]).toMatchObject({ event: "error" })
    expect(String(r.events[0]?.message)).toContain("--size")
  })
})

describe("--drive 交互会话", () => {
  test("click 文本定位 + values + Esc 穿透 submit，退出码 0", async () => {
    const commands = [
      { id: 1, op: "click", text: "7", return: "none" },
      { id: 2, op: "click", text: "+", return: "none" },
      { id: 3, op: "click", text: "8", return: "none" },
      { id: 4, op: "click", text: "=", return: "none" },
      { id: 5, op: "values" },
      { id: 6, op: "press", key: "escape" },
    ]
    const r = await runCli(
      ["--schema", CALC_SCHEMA, "--drive", "--size", "60x28"],
      commands.map((c) => JSON.stringify(c)).join("\n") + "\n",
    )
    expect(r.exitCode).toBe(0)
    expect(r.events[0]).toMatchObject({ event: "ready" })
    const values = r.events.find((e) => e.id === 5)
    expect(values).toMatchObject({ ok: true, values: { display: "15" } })
    expect(r.events.at(-1)).toMatchObject({ event: "submit", values: { display: "15" } })
  })

  test("snapshot 操作回帧、locate 返回坐标、未知操作报错", async () => {
    const commands = [
      { id: 1, op: "snapshot" },
      { id: 2, op: "locate", text: "AC" },
      { id: 3, op: "fly" },
      { id: 4, op: "quit" },
    ]
    const r = await runCli(
      ["--schema", CALC_SCHEMA, "--drive", "--size", "60x28"],
      commands.map((c) => JSON.stringify(c)).join("\n") + "\n",
    )
    expect(r.exitCode).toBe(1)
    expect(String((r.events.find((e) => e.id === 1) as { frame?: string }).frame)).toContain(
      "TUI 计算器",
    )
    expect(r.events.find((e) => e.id === 2)).toMatchObject({ ok: true })
    expect(r.events.find((e) => e.id === 3)).toMatchObject({ ok: false })
    expect(r.events.at(-1)).toMatchObject({ event: "cancel" })
  })
})
