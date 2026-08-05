import { afterEach, describe, expect, test } from "bun:test"
import { BaseRenderable, parseColor, ScrollBoxRenderable } from "@opentui/core"
import type { ReactNode } from "react"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
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

  test("一次性命令渲染成卡片（$ 头 + 输出）", async () => {
    const t = await mount()
    await t.type("echo hello-shell")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("hello-shell"))
    const frame = t.frame()
    expect(frame).toContain("hello-shell")
    expect(frame).toContain("$")
  })

  test("输入与输出使用不同底色并连续相邻", async () => {
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
    await t.type("seq 1 20")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("输入 Agent 提示"))
    expect(t.raw.renderer.getCursorState().visible).toBe(true)

    const scrollbox = findScrollbox(t.raw.renderer.root)!
    const bottom = Math.max(0, scrollbox.scrollHeight - scrollbox.viewport.height)
    scrollbox.scrollBy(-2)
    await t.settle()
    expect(scrollbox.scrollTop).toBeLessThan(bottom)
    expect(t.raw.renderer.getCursorState().visible).toBe(false)

    scrollbox.scrollTo(bottom)
    await t.settle()
    expect(t.raw.renderer.getCursorState().visible).toBe(true)
  })

  test("重型终端打开弹窗浮层", async () => {
    const t = await mount()
    await t.type("bash")
    await t.enter()
    // 浮层头部提示出现 Ctrl+O
    await t.waitUntil(() => t.frame().includes("Ctrl+O"))
    expect(t.frame()).toContain("Ctrl+O")
  })

  test("弹窗程序退出后关闭并在流里留结果卡片", async () => {
    const t = await mount()
    await t.type("bash")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("Ctrl+O"))
    await t.type("exit")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("▶ bash"))
    expect(t.frame()).toContain("▶ bash")
    // 浮层已关闭
    expect(t.frame()).not.toContain("Ctrl+O")
  })

  test("inlineCommands 命中 → 流内活终端卡片", async () => {
    const t = await mount({ inlineCommands: ["cat"] }, { height: 30 })
    await t.type("cat")
    await t.enter()
    // 流内终端卡片头部含 ▶ cat
    await t.waitUntil(() => t.frame().includes("▶ cat"))
    expect(t.frame()).toContain("▶ cat")
  })
})
