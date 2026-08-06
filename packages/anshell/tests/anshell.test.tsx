import { afterEach, describe, expect, test } from "bun:test"
import { BaseRenderable, parseColor, ScrollBoxRenderable } from "@opentui/core"
import { act, type ReactNode } from "react"
import { KeyCodes, renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { Anshell, cardTint, type AnshellProps } from "../src/index"

let active: TuiTestSetup | null = null

afterEach(() => {
  active?.destroy()
  active = null
})

async function mount(props: AnshellProps = {}, options?: { width?: number; height?: number }) {
  const t = await renderTui(<Anshell {...props} /> as ReactNode, {
    width: options?.width ?? 60,
    height: options?.height ?? 14,
    // 生产 CLI 由 Anshell 接管 Ctrl-C；测试渲染器默认 true 会先销毁整个画面。
    exitOnCtrlC: false,
  })
  active = t
  return t
}

function findScrollbox(node: BaseRenderable): ScrollBoxRenderable | undefined {
  if (node instanceof ScrollBoxRenderable) return node
  for (const child of node.getChildren()) {
    const match = findScrollbox(child)
    if (match) return match
  }
  return undefined
}

const CURSOR_BACKGROUND = parseColor("#dcdcdc").toInts()

function hasStyledCursor(t: TuiTestSetup): boolean {
  return t.raw.captureSpans().lines.some((line) => line.spans.some((span) => {
    const bg = span.bg.toInts()
    return span.text === " " && bg.every((value, index) => value === CURSOR_BACKGROUND[index])
  }))
}

describe("Anshell 流式布局", () => {
  test("初始草稿为 Agent 提示符（无独立底部框）", async () => {
    const t = await mount()
    await t.waitUntil(() => t.frame().includes("◆"))
    expect(t.frame()).toContain("◆")
  })

  test("识别到命令后切为 shell 风格 <cwd> $ command（所见即所得）", async () => {
    const t = await mount()
    await t.type("echo header-test")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("$ echo header-test"))
    // 命令头原样带提示符与命令（与草稿所打一致）
    expect(t.frame()).toContain("$ echo header-test")
  })

  test("普通命令渲染成自然高度的 PTY 卡片（$ 头 + 输出）", async () => {
    const t = await mount()
    await t.type("echo hello-shell")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("hello-shell"))
    const frame = t.frame()
    expect(frame).toContain("hello-shell")
    expect(frame).toContain("$")
  })

  test("输入头与 PTY 内容使用不同底色并连续相邻", async () => {
    const t = await mount({}, { width: 60, height: 10 })
    await t.type("echo $((6*7))")
    await t.enter()
    await t.waitUntil(() => t.frame().split("\n").some((line) => line.trim() === "42"))
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"))

    const textLines = t.frame().split("\n")
    const inputRow = textLines.findIndex((line) => line.includes("$ echo $((6*7))"))
    const outputRow = textLines.findIndex((line) => line.trim() === "42")
    const draftRow = textLines.findIndex((line) => line.includes("◆ 输入 Agent 提示"))
    expect(outputRow).toBe(inputRow + 1)
    expect(draftRow).toBe(outputRow + 1)

    const captured = t.raw.captureSpans()
    const commandSpan = captured.lines[inputRow]!.spans.find((span) => span.text.includes("echo"))
    const outputSpan = captured.lines[outputRow]!.spans.find((span) => span.text.includes("42"))
    expect(commandSpan?.bg.toInts()).toEqual(parseColor(cardTint.input).toInts())
    expect(outputSpan?.bg.toInts()).toEqual(parseColor(cardTint.output).toInts())
    expect(commandSpan?.bg.toInts()).not.toEqual(outputSpan?.bg.toInts())
  })

  test("cwd 进提示前缀（cd 后更新，无独立状态行）", async () => {
    const t = await mount()
    await t.type("cd /tmp")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("/tmp"))
    expect(t.frame()).toContain("/tmp")
  })

  test("自然语言且未配置 agent → 系统提示", async () => {
    const t = await mount()
    await t.type("帮我写个函数")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("未配置 agent"))
    expect(t.frame()).toContain("未配置 agent")
    expect(t.frame()).toContain("◆ 帮我写个函数")
  })

  test("Ctrl+T 显式切换当前草稿路由，提交后恢复自动识别", async () => {
    const t = await mount()
    await t.type("echo forced-agent")
    expect(t.frame()).toContain("$ echo forced-agent")
    await t.press("t", { ctrl: true })
    expect(t.frame()).toContain("◆ echo forced-agent")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("未配置 agent"))
    expect(t.frame()).toContain("◆ echo forced-agent")
    // 新草稿不继承强制路由，空输入按自动规则回到 Agent。
    expect(t.frame()).toContain("◆ 输入 Agent 提示")
  })

  test("Ctrl+C 取消当前草稿，不执行也不进入历史", async () => {
    const t = await mount()
    await t.type("echo should-be-skipped")
    expect(t.frame()).toContain("$ echo should-be-skipped")
    await t.press("t", { ctrl: true })
    expect(t.frame()).toContain("◆ echo should-be-skipped")

    await t.press("c", { ctrl: true })
    await t.waitUntil(() => t.frame().includes("◆ 输入 Agent 提示"))
    expect(t.frame()).not.toContain("should-be-skipped")

    // 取消后回到自动路由，且 ↑ 不会找回未执行的草稿。
    await t.press(KeyCodes.ARROW_UP)
    expect(t.frame()).toContain("◆ 输入 Agent 提示")
    await t.type("echo next-command")
    await t.enter()
    await t.waitUntil(() => t.frame().split("\n").some((line) => line.trim() === "next-command"))
  })

  test("Tab 完成目录并保留输入焦点", async () => {
    const t = await mount({ cwd: "/" })
    await t.type("cd /hom")
    await t.tab()
    await t.waitUntil(() => t.frame().includes("cd /home/"))
    expect(t.frame()).toContain("$ cd /home/")
    await t.type("x")
    expect(t.frame()).toContain("cd /home/x")
  })

  test("上滚离开草稿时隐藏光标，回到底部后恢复", async () => {
    const t = await mount({}, { width: 60, height: 8 })
    for (const value of ["first", "second", "third", "fourth", "fifth"]) {
      await t.type(`echo ${value}`)
      await t.enter()
      await t.waitUntil(() => t.frame().includes("输入 Agent 提示"))
    }
    expect(t.raw.renderer.getCursorState().visible).toBe(true)

    const scrollbox = findScrollbox(t.raw.renderer.root)!
    const bottom = Math.max(0, scrollbox.scrollHeight - scrollbox.viewport.height)
    scrollbox.scrollBy(-2)
    await t.settle()
    expect(scrollbox.scrollTop).toBeLessThan(bottom)
    expect(t.raw.renderer.getCursorState().visible).toBe(false)

    // PTY 的最后一帧可能在上滚期间补齐自然高度，回底时按最新 scrollHeight 定位。
    scrollbox.scrollTo(Math.max(0, scrollbox.scrollHeight - scrollbox.viewport.height))
    await t.waitUntil(() => t.raw.renderer.getCursorState().visible)
  })

  test("bash 不再按命令名特判，直接融入自然 PTY 流", async () => {
    const t = await mount()
    await t.type("bash")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("$ bash"))
    expect(t.frame()).not.toContain("Ctrl-D/exit 退出")
    await t.waitUntil(() => t.frame().includes("antd-tui]$"), 4000)
    await t.type("echo $((40+2))")
    await t.enter()
    await t.waitUntil(() => t.frame().split("\n").some((line) => line.trim() === "42"), 4000)
    await t.type("exit")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"), 4000)
  })

  test("交互 bash 的 prompt、连续输入和 PTY 光标都可见", async () => {
    if (!Bun.which("bash")) return
    const t = await mount()
    await t.type("PS1='BASH> ' bash --norc -i")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("BASH> "), 4000)
    await t.waitUntil(() => hasStyledCursor(t))
    expect(t.frame()).not.toContain("█")
    await t.type("echo $((20+22))")
    await t.enter()
    await t.waitUntil(() => t.frame().split("\n").some((line) => line.trim() === "42"), 4000)
    await t.waitUntil(() => t.frame().split("BASH> ").length >= 3, 4000)
    await t.type("exit")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"), 4000)
  })

  test("PTY 进入 alternate screen 时提升同一会话到浮层，退出后回到自然流", async () => {
    const t = await mount()
    await t.type(String.raw`printf '\e[?1049hALT'; read answer; printf '\e[?1049lBACK\n'`)
    await t.enter()
    // 全屏浮层不留 chrome：卡片头被整屏盖住即说明已提升
    await t.waitUntil(() => t.frame().includes("ALT") && !t.frame().includes("$ printf"))
    await t.type("resume")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"), 4000)
    expect(t.frame()).toContain("$ printf")
    expect(t.frame()).toContain("BACK")
  })

  test("提升为全屏后子进程拿到整屏行数，底部不留空行", async () => {
    const t = await mount({}, { height: 20 })
    await t.type(String.raw`printf '\e[?1049h'; read a; stty size; read b; printf '\e[?1049l'`)
    await t.enter()
    await t.type("go")
    await t.enter()
    // 测试画布 60×20：全屏若仍留一行状态提示，子进程只会看到 19 行
    await t.waitUntil(() => t.frame().includes("20 60"), 4000)
    await t.type("done")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"), 4000)
  })

  test("normal buffer 整屏重画留在原卡片并切换为当前 viewport", async () => {
    const t = await mount()
    await t.type(String.raw`printf 'FLOW'; read first; printf '\e[H\e[2J\e[HREDRAW'; read second`)
    await t.enter()
    await t.waitUntil(() => t.frame().includes("FLOW"))
    expect(t.frame()).not.toContain("screen repaint")

    await t.type("move-right")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("REDRAW"), 4000)
    expect(t.frame()).not.toContain("screen repaint")
    expect(t.frame()).not.toContain("alternate screen")
    expect(t.frame()).toContain("$ printf")

    await t.type("finish")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"), 4000)
    await t.waitUntil(() => t.frame().includes("REDRAW"), 4000)
  })

  test("vim 由 alternate-screen 行为自动提升，而不是命令名特判", async () => {
    if (!Bun.which("vim")) return
    const t = await mount()
    await t.type("vim -Nu NONE -i NONE -n")
    await t.enter()
    await t.waitUntil(() => t.frame().split("\n").some((line) => line.trim() === "~"), 4000)
    await t.settle()
    await t.escape()
    await t.type(":qa!")
    await t.waitUntil(() => t.frame().includes(":qa!"))
    await t.enter()
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"), 4000)
    expect(t.frame()).toContain("$ vim -Nu NONE -i NONE -n")
  })

  test("所有普通命令组成流内 PTY 卡片并原样接收键盘", async () => {
    const t = await mount()
    await t.type("cat -")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("$ cat -"))
    expect(t.frame()).not.toContain("Ctrl-D/exit 退出")
    await t.type("hello-pty")
    await t.enter()
    // PTY 本地回显一次，cat 消费 stdin 后再输出一次；两行才能证明子进程真的收到了输入。
    await t.waitUntil(() => t.frame().split("\n").filter((line) => line.trim() === "hello-pty").length >= 2)
    await t.press("d", { ctrl: true })
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"))
    expect(t.frame()).toContain("$ cat -")
    expect(t.frame()).toContain("hello-pty")
    await t.type("next-draft")
    expect(t.frame()).toContain("◆ next-draft")
  })

  test("提交命令后不等待重绘，紧接的输入仍交给 PTY 且显示光标", async () => {
    const t = await mount()
    await t.type("cat -")
    await act(async () => {
      t.raw.mockInput.pressEnter()
      t.raw.mockInput.typeText("immediate-stdin")
      t.raw.mockInput.pressEnter()
    })
    await t.waitUntil(() => t.frame().split("\n").filter((line) => line.trim() === "immediate-stdin").length >= 2)
    expect(t.frame()).toContain("$ cat -")
    expect(t.frame()).not.toContain("█")
    await t.press("d", { ctrl: true })
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"))
  })

  test("Ctrl+O 强制把任意 Shell 整行放进 PTY", async () => {
    const t = await mount()
    await t.type("read answer; echo got:$answer")
    await t.press("o", { ctrl: true })
    await t.waitUntil(() => !t.frame().includes("输入 Agent 提示"))
    await t.type("forced-input")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("got:forced-input"))
    // 退出后与其他 shell 卡片同款：`<cwd> $ <整行>  (exit 0)` 留在列表里
    await t.waitUntil(() => t.frame().includes("$ read answer; echo got:$answer"), 4000)
    await t.waitUntil(() => t.frame().includes("(exit 0)"), 4000)
    expect(t.frame()).toContain("got:forced-input")
  })

  test("inlineCommands 命中 → 流内活终端卡片", async () => {
    const t = await mount({ inlineCommands: ["cat"] }, { height: 30 })
    await t.type("cat")
    await t.enter()
    // 显式 inline 命令同样使用自然高度的流内 PTY。
    await t.waitUntil(() => t.frame().includes("▶ cat"))
    expect(t.frame()).toContain("▶ cat")
  })
})
