import { describe, expect, test } from "bun:test"
import { resolveShellDialect } from "../src/shell/dialect"
import { bashRcSource, zshRcSources, type ShellRcOptions } from "../src/shell/rc"
import { computeRange, type RangeInput } from "../src/shell/range"

describe("resolveShellDialect", () => {
  test("按 basename 认出 bash / zsh", () => {
    expect(resolveShellDialect("/bin/bash").dialect).toBe("bash")
    expect(resolveShellDialect("/usr/local/bin/zsh").dialect).toBe("zsh")
    expect(resolveShellDialect("/opt/homebrew/bin/bash-5.2").dialect).toBe("bash")
  })
  test("其它 shell 判为不支持", () => {
    expect(resolveShellDialect("/usr/bin/fish").dialect).toBeNull()
    expect(resolveShellDialect("/bin/dash").dialect).toBeNull()
  })
})

const rcOpts = (over: Partial<ShellRcOptions> = {}): ShellRcOptions => ({
  dialect: "bash",
  nonce: "NONCE",
  runtimeDir: "/run",
  init: "user",
  ...over,
})

describe("bashRcSource", () => {
  test("PROMPT_COMMAND 前置 __ansh_precmd（$? 才是命令的退出码）", () => {
    const src = bashRcSource(rcOpts())
    expect(src).toContain("PROMPT_COMMAND=(__ansh_precmd")
    expect(src).toContain('PROMPT_COMMAND="__ansh_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}"')
  })
  test("标记带 nonce，静默命令保留用户退出码", () => {
    const src = bashRcSource(rcOpts())
    expect(src).toContain("ansh=%s")
    expect(src).toContain("__ansh_user_status")
    expect(src).toContain("ignorespace")
  })
  test("user 模式 source ~/.bashrc，minimal 不碰用户配置", () => {
    expect(bashRcSource(rcOpts({ init: "user" }))).toContain(". ~/.bashrc")
    const minimal = bashRcSource(rcOpts({ init: "minimal" }))
    expect(minimal).not.toContain(". ~/.bashrc")
    expect(minimal).toContain('PS1="ANSH> "')
  })
})

describe("zshRcSources", () => {
  test("四个启动文件都在，.zshrc 装钩子并还原 ZDOTDIR", () => {
    const files = zshRcSources(rcOpts({ dialect: "zsh" }))
    expect(Object.keys(files).sort()).toEqual([".zlogin", ".zprofile", ".zshenv", ".zshrc"])
    expect(files[".zshrc"]).toContain("add-zsh-hook precmd __ansh_precmd")
    expect(files[".zshrc"]).toContain("ANSH_USER_ZDOTDIR")
    expect(files[".zshrc"]).toContain("unset ZDOTDIR")
  })
  test("user 模式链式 source 用户原文件", () => {
    const files = zshRcSources(rcOpts({ dialect: "zsh", init: "user" }))
    expect(files[".zshrc"]).toContain("ANSH_USER_ZDOTDIR:-$HOME}/.zshrc")
  })
})

const base = (over: Partial<RangeInput> = {}): RangeInput => ({
  start: { row: 4, col: 0 },
  end: null,
  markRow: 4,
  cursorAbsoluteY: 5,
  viewportY: 0,
  viewportRows: 10,
  bufferLength: 100,
  highWater: 0,
  takeover: false,
  ...over,
})

describe("computeRange", () => {
  test("已结束：[C, D)，末列非 0 时含末行并记截断列", () => {
    const r = computeRange(base({ start: { row: 4, col: 0 }, end: { row: 6, col: 0 } }))
    expect(r).toMatchObject({ startY: 4, rows: 2, viewport: false, degraded: false })
    expect(r.lastCol).toBeUndefined()
    const clipped = computeRange(base({ start: { row: 4, col: 0 }, end: { row: 6, col: 3 } }))
    expect(clipped).toMatchObject({ startY: 4, rows: 3, lastCol: 3 })
  })
  test("cd 类：C.row === D.row → 空区间", () => {
    expect(computeRange(base({ start: { row: 4, col: 0 }, end: { row: 4, col: 0 } })).rows).toBe(0)
  })
  test("运行中：结束行取水位线与光标较大值并单调", () => {
    const r = computeRange(base({ cursorAbsoluteY: 7, highWater: 9 }))
    expect(r.highWater).toBe(9) // 光标回跳不缩卡
    expect(r.rows).toBe(9 - 4 + 1)
  })
  test("标记被裁（row=-1）→ 从 buffer 尾部兜底并标 degraded", () => {
    const r = computeRange(base({ markRow: -1, end: { row: 50, col: 0 }, bufferLength: 40, viewportRows: 10 }))
    expect(r.degraded).toBe(true)
    expect(r.startY).toBe(30)
  })
  test("整屏重画 → 只冻结视口并 degraded", () => {
    const r = computeRange(base({ takeover: true, viewportY: 12, viewportRows: 8 }))
    expect(r).toMatchObject({ startY: 12, rows: 8, viewport: true, degraded: true })
  })
})
