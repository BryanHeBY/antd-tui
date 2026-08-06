import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type ReactNode } from "react"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { Anshell, type AnshellProps } from "../src/index"

const MOCK_AGENT = join(import.meta.dir, "mock-agent.ts")

let active: TuiTestSetup | null = null

afterEach(() => {
  active?.destroy()
  active = null
})

async function mount(props: AnshellProps = {}, options?: { width?: number; height?: number }) {
  const t = await renderTui(
    <Anshell agentCmd={["bun", MOCK_AGENT]} {...props} /> as ReactNode,
    {
      width: options?.width ?? 76,
      height: options?.height ?? 22,
      exitOnCtrlC: false,
    },
  )
  active = t
  // agent 起来之前本地命令表只有 /help；等能力就绪再断言菜单
  await t.type("/")
  await t.waitUntil(() => t.frame().includes("/session"), 15000)
  await t.press("c", { ctrl: true })
  return t
}

/** 草稿卡回来了才输入：轮次在途时草稿不渲染，按键会没人接。 */
async function idle(t: TuiTestSetup) {
  await t.waitUntil(() => t.frame().includes("输入 Agent 提示"), 10000)
}

async function send(t: TuiTestSetup, line: string) {
  await idle(t)
  await t.type(line)
  await t.enter()
}

describe("Anshell 的 agent 接入", () => {
  test("斜杠菜单列出按能力过滤的本地命令，Esc 收起", async () => {
    const t = await mount()
    await t.type("/")
    await t.waitUntil(() => t.frame().includes("/permissions"))
    const frame = t.frame()
    expect(frame).toContain("/session")
    expect(frame).toContain("/mode")
    expect(frame).toContain("/model")
    expect(frame).toContain("/cancel")
    await t.escape()
    await t.waitUntil(() => !t.frame().includes("/permissions"))
  }, 30000)

  test("↑↓ 移动选中项而不是翻命令历史", async () => {
    const t = await mount()
    await send(t, "echo history-entry")
    await t.waitUntil(() => t.frame().includes("$ echo history-entry"))
    // PTY 卡片跑完、草稿归位之后再敲，否则按键会被流内 PTY 收走
    await idle(t)
    await t.type("/s")
    await t.waitUntil(() => t.frame().includes("▸ /session"))
    await t.press("down")
    // 菜单里向下走到下一项；若走的是历史，草稿会变成 echo history-entry
    await t.waitUntil(() => !t.frame().includes("▸ /session"))
    expect(t.frame()).not.toContain("$ echo history-entry\n$ echo history-entry")
    expect(t.frame()).toContain("/s")
  }, 30000)

  test("/session 经 session/list 列出会话并标出当前会话", async () => {
    const t = await mount()
    await send(t, "/session")
    await t.waitUntil(() => t.frame().includes("mock-old"), 10000)
    const frame = t.frame()
    // 卡片头与所打逐字一致：斜杠不掉、不多空格
    expect(frame).toContain("/session")
    expect(frame).toContain("▸ mock-session")
    expect(frame).toContain("历史会话")
  }, 30000)

  test("/mode 列出模式并能切换", async () => {
    const t = await mount()
    await send(t, "/mode")
    await t.waitUntil(() => t.frame().includes("▸ chat"))
    expect(t.frame()).toContain("agentic")
    await send(t, "/mode agentic")
    await t.waitUntil(() => t.frame().includes("已切到模式 agentic"), 10000)
  }, 30000)

  test("/model 走 set_config_option（ACP 没有 set_model）", async () => {
    const t = await mount()
    await send(t, "/model")
    await t.waitUntil(() => t.frame().includes("▸ fast"))
    await send(t, "/model smart")
    await t.waitUntil(() => t.frame().includes("已切到 smart"), 10000)
  }, 30000)

  test("agent 推来的命令进入同一菜单并编译成 prompt", async () => {
    const t = await mount()
    await send(t, "commands")
    await t.waitUntil(() => t.frame().includes("命令表已推送"), 10000)
    await t.type("/rev")
    await t.waitUntil(() => t.frame().includes("· agent"))
    expect(t.frame()).toContain("/review")
    // 带 hint 的命令：Enter 先补全命令名等参数
    await t.enter()
    await t.waitUntil(() => t.frame().includes("/review "))
    await t.type("src")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("收到:/review src"), 10000)
  }, 30000)

  test("工具调用落成卡片并按 toolCallId 更新状态", async () => {
    const t = await mount()
    await send(t, "tool")
    await t.waitUntil(() => t.frame().includes("读取 README.md"), 10000)
    await t.waitUntil(() => t.frame().includes("[完成]"), 10000)
    const frame = t.frame()
    expect(frame).toContain("read")
    expect(frame).toContain("tool-output-line")
    // 同一个 toolCallId 只有一张卡片
    expect(frame.split("读取 README.md").length - 1).toBe(1)
  }, 30000)

  test("权限请求变成待决策卡片，数字键决策后回给 agent", async () => {
    const t = await mount()
    await send(t, "ask")
    await t.waitUntil(() => t.frame().includes("需要授权"), 10000)
    const frame = t.frame()
    expect(frame).toContain("删除 /tmp/x")
    expect(frame).toContain("1. 允许一次")
    expect(frame).toContain("3. 拒绝")
    // 待决策时草稿不渲染，键盘完全归权限卡片
    expect(frame).not.toContain("输入 Agent 提示")
    await t.press("1")
    await t.waitUntil(() => t.frame().includes("权限结果 selected:yes"), 10000)
    expect(t.frame()).toContain("输入 Agent 提示")
  }, 30000)

  test("allow_always 写进记忆，第二次同名工具不再打断，/permissions 可审计", async () => {
    const t = await mount()
    await send(t, "ask")
    await t.waitUntil(() => t.frame().includes("需要授权"), 10000)
    await t.press("2")
    await t.waitUntil(() => t.frame().includes("权限结果 selected:always"), 10000)

    await send(t, "ask again")
    await t.waitUntil(() => t.frame().includes("（记忆）"), 10000)
    await send(t, "/permissions")
    await t.waitUntil(() => t.frame().includes("记忆  删除 /tmp/x"), 10000)
    expect(t.frame()).toContain("allow_always")
    await send(t, "/permissions reset")
    await t.waitUntil(() => t.frame().includes("已清空 1 条权限记忆"), 10000)
  }, 40000)

  test("轮次在途时不发新草稿，Esc 中断后草稿归位", async () => {
    const t = await mount()
    await send(t, "slow")
    // 仿 shell 的 prompt 未归位：agent 说完之前不出下一张输入卡
    await t.waitUntil(() => t.frame().includes("运行中 · Esc 中断"), 10000)
    expect(t.frame()).not.toContain("输入 Agent 提示")
    await t.escape()
    await t.waitUntil(() => t.frame().includes("已中断"), 10000)
    await idle(t)
  }, 30000)

  test("/usage 呈现 usage_update 上报的占用", async () => {
    const t = await mount()
    await send(t, "usage")
    await t.waitUntil(() => t.frame().includes("已上报用量"), 10000)
    await send(t, "/usage")
    await t.waitUntil(() => t.frame().includes("1200/8000"), 10000)
  }, 30000)

  test("绝对路径命令不被斜杠层劫持", async () => {
    const t = await mount()
    await t.type("/bin/echo path-not-command")
    // 首词含第二个 / → 仍是 shell 分诊，提示符是 $ 而不是 /
    await t.waitUntil(() => t.frame().includes("$ /bin/echo path-not-command"))
    await t.enter()
    await t.waitUntil(() => t.frame().includes("path-not-command"), 10000)
  }, 30000)
})
