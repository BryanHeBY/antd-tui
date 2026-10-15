import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { type ReactNode } from "react"
import { renderTui, type TuiTestSetup } from "@antd-tui/test-utils"
import { Anshell, type AnshellProps } from "../src/index"
import { displayWidth } from "@antd-tui/components"
import { createModels } from "@earendil-works/pi-ai"
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux"

const MOCK_AGENT = join(import.meta.dir, "mock-agent.ts")


/** 帧内定位文本的中心坐标，供 mockMouse 点击 */
function locate(frame: string, target: string): { x: number; y: number } {
  const lines = frame.split("\n")
  for (let y = 0; y < lines.length; y++) {
    const idx = lines[y]!.indexOf(target)
    if (idx >= 0) {
      const x = displayWidth(lines[y]!.slice(0, idx))
      return { x: x + Math.floor(displayWidth(target) / 2), y }
    }
  }
  throw new Error(`帧中找不到 "${target}"`)
}

let active: TuiTestSetup | null = null

afterEach(() => {
  active?.destroy()
  active = null
})

async function mount(props: AnshellProps = {}, options?: { width?: number; height?: number }) {
  const t = await renderTui(
    <Anshell agent={{ kind: "acp", cmd: ["bun", MOCK_AGENT] }} {...props} /> as ReactNode,
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
    await t.waitUntil(() => t.frame().includes("记忆 删除 /tmp/x"), 10000)
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

describe("Anshell 的 pi 原生后端", () => {
  test("自然语言分诊给进程内 agent，回复落成卡片", async () => {
    const faux = fauxProvider()
    const models = createModels()
    models.setProvider(faux.provider)
    faux.setResponses([fauxAssistantMessage([fauxText("这是 pi 的回答")])])

    const t = await renderTui(
      <Anshell
        agent={{ kind: "pi", spec: "faux/faux-1" }}
        piModels={models}
        shellInit="minimal"
      />,
      { width: 90, height: 20 },
    )
    active = t

    await idle(t)
    await t.type("用一句话介绍你自己")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("这是 pi 的回答"), 8000)

    // 能力全关：斜杠菜单只剩 /help，不再出现 /session /mode
    await idle(t)
    await t.type("/")
    await t.waitUntil(() => t.frame().includes("/help"), 8000)
    expect(t.frame()).not.toContain("/session")
    // 带尾随空格避免撞上原生 /model 的前缀
    expect(t.frame()).not.toContain("/mode ")
    await t.press("c", { ctrl: true })
  }, 30000)
})

describe("Anshell × pi 原生 slash 命令", () => {
  test("/model 在输入框里直接切换模型，/effort 显示当前力度", async () => {
    const faux = fauxProvider({ models: [{ id: "faux-a" }, { id: "faux-b" }] })
    const models = createModels()
    models.setProvider(faux.provider)
    faux.setResponses([fauxAssistantMessage([fauxText("收到")])])

    const t = await renderTui(
      <Anshell
        agent={{ kind: "pi", spec: "faux/faux-a" }}
        piModels={models}
        shellInit="minimal"
      />,
      { width: 90, height: 20 },
    )
    active = t

    await idle(t)
    await t.type("/model faux/faux-b")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("模型已切换：faux/faux-b"), 8000)

    await idle(t)
    await t.type("/effort")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("当前力度"), 8000)

    // 菜单里出现原生命令，且不再有 ACP 专属的 /session
    await idle(t)
    await t.type("/")
    await t.waitUntil(() => t.frame().includes("/model"), 8000)
    await t.waitUntil(() => t.frame().includes("/reset"), 8000)
    expect(t.frame()).not.toContain("/session")
    await t.press("c", { ctrl: true })
  }, 30000)
})

describe("Anshell × agent 宿主工具", () => {
  test("agent 命令渐进披露：短输出保留、长输出折叠、旧卡被超越后收头；结果回给 agent", async () => {
    const faux = fauxProvider()
    const models = createModels()
    models.setProvider(faux.provider)
    // 三次 exec：短成功（old-$((40+2)) → 输出 42，label 不含 42）→ 长成功（seq 50 60）→ history
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("ansh_exec", { command: "echo old-$((40+2))" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("第一条完成")]),
      fauxAssistantMessage([fauxToolCall("ansh_exec", { command: "seq 50 60" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxText("第二条完成")]),
      fauxAssistantMessage([fauxToolCall("ansh_history", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("历史已读")]),
    ])

    const t = await renderTui(
      <Anshell agent={{ kind: "pi", spec: "faux/faux-1" }} piModels={models} shellInit="minimal" />,
      { width: 96, height: 22 },
    )
    active = t

    await idle(t)
    await t.type("跑第一条")
    await t.enter()

    // 第一条：短输出（1 行）全量保留——「42」只见于输出体，label 不含它
    await t.waitUntil(() => t.frame().includes("第一条完成"), 15000)
    expect(t.frame()).toContain("42")
    expect(t.frame()).toContain("◆")
    // 工具卡与原始 JSON 不上屏
    expect(t.frame()).not.toContain("ansh_exec")
    expect(t.frame()).not.toContain('"exitCode"')

    await idle(t)
    await t.type("跑第二条")
    await t.enter()

    // 第二条：长输出（11 行 > 5）折叠为头部 ▸ 计数；输出行「54」只在折叠体内
    await t.waitUntil(() => t.frame().includes("第二条完成"), 15000)
    expect(t.frame()).toContain("seq 50 60")
    expect(t.frame()).toContain("▸ 11 行已交给 agent")
    expect(t.frame()).not.toContain("54")
    // 第一条被超越：短输出也收成头部一行
    expect(t.frame()).not.toContain("42")

    // 点击折叠卡：展开全量（54 可见、▾ 标记），再点收起（54 消失、▸ 回来）
    const header = locate(t.frame(), "seq 50 60")
    await t.click(header.x, header.y)
    await t.waitUntil(() => t.frame().includes("54"), 8000)
    expect(t.frame()).toContain("▾ 11 行")
    await t.click(header.x, header.y)
    await t.waitUntil(() => !t.frame().includes("54"), 8000)
    expect(t.frame()).toContain("▸ 11 行")

    // ansh_history：单行摘要（第三问触发）
    await idle(t)
    await t.type("看看历史")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("↺ 历史"), 15000)
    expect(faux.state.callCount).toBeGreaterThanOrEqual(6)
  }, 40000)
})
