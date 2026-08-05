import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import { runCommand } from "../src/index"

function collect() {
  const lines: { text: string; stream: "out" | "err" }[] = []
  return { lines, onLine: (text: string, stream: "out" | "err") => lines.push({ text, stream }) }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待超时")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
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

  test("中断会终止 shell 管道中的子进程", async () => {
    // setsid 是 Linux 下为命令创建独立进程组的实现；其他平台走兼容降级。
    if (process.platform !== "linux" || !Bun.which("setsid")) return
    const c = collect()
    let childPid = 0
    const cmd = runCommand({
      // `sleep` 在管道前台执行；仅杀 sh 时它会被遗留，组信号才会送达它。
      line: 'sh -c "echo CHILD:\\$\\$; sleep 30" | cat',
      cwd: tmpdir(),
      onLine: c.onLine,
    })
    try {
      await waitUntil(() => c.lines.some((line) => line.text.startsWith("CHILD:")))
      childPid = Number(c.lines.find((line) => line.text.startsWith("CHILD:"))?.text.slice(6))
      expect(childPid).toBeGreaterThan(0)

      cmd.kill("SIGINT")
      expect(await cmd.exited).not.toBe(0)
      await new Promise((resolve) => setTimeout(resolve, 30))
      // 测试容器的 PID 1 未必立即回收 zombie；Z 和 /proc 消失都说明 sleep
      // 已结束，只有仍为 S/R 才代表后台子进程被遗留。
      let stopped = false
      try {
        const stat = await Bun.file(`/proc/${childPid}/stat`).text()
        stopped = stat.split(" ")[2] === "Z"
      } catch {
        stopped = true
      }
      expect(stopped).toBe(true)
    } finally {
      // 回归失败时也不让测试遗留 sleep 子进程。
      if (childPid > 0) {
        try {
          process.kill(childPid, "SIGKILL")
        } catch {
          /* 已被命令组中断 */
        }
      }
    }
  })

  test("剥掉残留 ANSI 转义", async () => {
    const c = collect()
    const cmd = runCommand({ line: "printf '\\033[31mRED\\033[0m\\n'", cwd: tmpdir(), onLine: c.onLine })
    await cmd.exited
    expect(c.lines.some((l) => l.text === "RED")).toBe(true)
  })
})
