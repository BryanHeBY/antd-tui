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
  const events = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
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
})
