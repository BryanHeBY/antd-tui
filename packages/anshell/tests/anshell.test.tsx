import { afterEach, describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { Anshell, type AnshellProps } from "../src/index"

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

describe("Anshell 流式布局", () => {
  test("初始就有草稿提示符（shell 行内输入，无独立底部框）", async () => {
    const t = await mount()
    // 未输入时流尾草稿卡片已显示 ❯ 提示符
    await t.waitUntil(() => t.frame().includes("❯"))
    expect(t.frame()).toContain("❯")
  })

  test("命令头是 shell 风格 <cwd> ❯ command（所见即所得）", async () => {
    const t = await mount()
    await t.type("echo header-test")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("❯ echo header-test"))
    // 命令头原样带提示符与命令（与草稿所打一致）
    expect(t.frame()).toContain("❯ echo header-test")
  })

  test("一次性命令渲染成卡片（❯ 头 + 输出）", async () => {
    const t = await mount()
    await t.type("echo hello-shell")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("hello-shell"))
    const frame = t.frame()
    expect(frame).toContain("hello-shell")
    expect(frame).toContain("❯")
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
