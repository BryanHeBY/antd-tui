import { afterEach, describe, expect, test } from "bun:test"
import { createShellSession, completeLive, type ShellSession } from "../src/shell"

let active: ShellSession | null = null
afterEach(() => {
  active?.kill()
  active = null
})

async function waitUntil(predicate: () => boolean, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待超时")
    await new Promise((r) => setTimeout(r, 15))
  }
}

function start(): { session: ShellSession; ready: () => boolean } {
  let ready = false
  const session = createShellSession({
    path: "/bin/bash",
    dialect: "bash",
    cwd: process.cwd(),
    cols: 80,
    rows: 20,
    init: "minimal",
    events: {
      onReady: () => (ready = true),
      onCommandStart: () => {},
      onCommandEnd: () => {},
      onCwd: () => {},
      onExit: () => {},
    },
  })
  active = session
  return { session, ready: () => ready }
}

describe("completeLive (bash)", () => {
  test("用 -W 注册的 spec 能补出候选", async () => {
    const { session, ready } = start()
    await waitUntil(ready)
    // 注册一个固定候选表的命令（不依赖宿主的 bash-completion）
    await session.runHidden("complete -W 'alpha beta gamma' anshtest", { timeoutMs: 6000 })
    const result = await completeLive(session, "anshtest a", 10, 6000)
    expect(result).not.toBeNull()
    expect(result!.items.map((i) => i.value)).toEqual(["alpha"])
  }, 20000)

  test("124 重试：懒加载 spec 首调返回 124 后仍能补出", async () => {
    const { session, ready } = start()
    await waitUntil(ready)
    // 首调返回 124 并把真正的 spec 换上（模拟 _completion_loader）
    await session.runHidden(
      [
        "_ansh_lazy() { complete -W 'lazyone lazytwo' lazycmd; return 124; }",
        "complete -F _ansh_lazy lazycmd",
      ].join("\n"),
      { timeoutMs: 6000 },
    )
    const result = await completeLive(session, "lazycmd laz", 11, 6000)
    expect(result).not.toBeNull()
    expect(result!.items.map((i) => i.value).sort()).toEqual(["lazyone", "lazytwo"])
  }, 20000)

  test("未注册命令返回 null，交回宿主启发式（它更会处理路径/目录）", async () => {
    const { session, ready } = start()
    await waitUntil(ready)
    // minimal 环境没 source bash-completion，cat 无 spec → live 返回 null
    const result = await completeLive(session, "cat /xyz", 8, 3000)
    expect(result).toBeNull()
  }, 20000)

  test("git 真实补全（有 git 时）", async () => {
    if (!Bun.which("git")) return
    const { session, ready } = start()
    await waitUntil(ready)
    const result = await completeLive(session, "git chec", 8, 3000)
    // 懒加载环境下首次可能为空；有结果时应包含 checkout
    if (result && result.items.length > 0) {
      expect(result.items.some((i) => i.value.startsWith("chec"))).toBe(true)
    }
  }, 20000)
})
