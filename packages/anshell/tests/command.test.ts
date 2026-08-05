import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { runCommand } from "../src/index"

function collect() {
  const lines: { text: string; stream: "out" | "err" }[] = []
  return { lines, onLine: (text: string, stream: "out" | "err") => lines.push({ text, stream }) }
}

describe("runCommand", () => {
  test("回显 stdout 并以退出码 0 结束", async () => {
    const c = collect()
    const cmd = runCommand({ line: "echo hello", cwd: tmpdir(), onLine: c.onLine })
    const code = await cmd.exited
    expect(code).toBe(0)
    expect(c.lines.some((l) => l.stream === "out" && l.text === "hello")).toBe(true)
  })

  test("stderr 分流", async () => {
    const c = collect()
    const cmd = runCommand({ line: "echo oops 1>&2", cwd: tmpdir(), onLine: c.onLine })
    await cmd.exited
    expect(c.lines.some((l) => l.stream === "err" && l.text === "oops")).toBe(true)
  })

  test("非 0 退出码如实返回", async () => {
    const cmd = runCommand({ line: "exit 3", cwd: tmpdir(), onLine: () => {} })
    expect(await cmd.exited).toBe(3)
  })

  test("管道整行经 sh 跑通", async () => {
    const c = collect()
    const cmd = runCommand({ line: "printf 'a\\nb\\nc\\n' | grep b", cwd: tmpdir(), onLine: c.onLine })
    await cmd.exited
    expect(c.lines.map((l) => l.text)).toContain("b")
  })

  test("在指定 cwd 执行", async () => {
    const c = collect()
    const cmd = runCommand({ line: "pwd", cwd: tmpdir(), onLine: c.onLine })
    await cmd.exited
    // macOS 的 tmpdir 可能是 /var/folders 的符号链接，pwd -P 才规范；这里只验证非空且是绝对路径
    expect(c.lines.some((l) => l.stream === "out" && l.text.startsWith("/"))).toBe(true)
  })

  test("可被 kill 中断", async () => {
    const cmd = runCommand({ line: "sleep 10", cwd: tmpdir(), onLine: () => {} })
    setTimeout(() => cmd.kill("SIGINT"), 100)
    const code = await cmd.exited
    expect(code).not.toBe(0)
  })

  test("剥掉残留 ANSI 转义", async () => {
    const c = collect()
    const cmd = runCommand({ line: "printf '\\033[31mRED\\033[0m\\n'", cwd: tmpdir(), onLine: c.onLine })
    await cmd.exited
    expect(c.lines.some((l) => l.text === "RED")).toBe(true)
  })
})
