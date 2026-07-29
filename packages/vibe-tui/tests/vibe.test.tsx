import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { renderTui } from "@antd-tui/test-utils"
import { displayWidth } from "@antd-tui/components"
import { VibeApp } from "../src/VibeApp"
import { AcpClient } from "../src/acp"

/**
 * vibe-tui × mock agent 的闭环 E2E：
 * 输入 prompt → agent 经 MCP vibetui_eval 用 $ui 搭页面 → 画板渲染 →
 * 鼠标点按钮触发 $agent.send 回流 → agent 热换 → 帧更新。
 */

const MOCK_AGENT = join(import.meta.dir, "mock-agent.ts")

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

describe("vibe-tui × mock agent", () => {
  test("agent 在握手前退出时，start() 会明确失败而不是永久等待", async () => {
    const state: { exitCode: number | null } = { exitCode: null }
    const client = new AcpClient(["bun", "-e", "process.exit(7)"], {
      onUpdate: () => {},
      onExit: (code) => {
        state.exitCode = code
      },
    })

    await expect(client.start()).rejects.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(state.exitCode).toBe(7)
  }, 20000)

  test("prompt 生成页面 → 点击回流 → agent 重渲染", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 100,
      height: 24,
    })

    // agent 子进程握手完成
    await t.waitUntil(() => t.frame().includes("mock 就绪"), 12000)

    // 输入 prompt 生成计数器页面
    await t.type("counter")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("计数器"), 8000)
    expect(t.frame()).toContain("当前计数")
    expect(t.frame()).toContain("0")
    // 状态行有 agent 的流式反馈
    expect(t.frame()).toContain("已渲染计数器")

    // 输入行模式下鼠标直达画板：点 +1 → $agent.send('inc') 回流 → 重渲染 count=1
    const pos = locate(t.frame(), " +1 ")
    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.waitUntil(() => t.frame().includes("count=1"), 8000)
    expect(t.frame()).toContain("1")

    t.destroy()
  }, 20000)

  test("输入行模式下画板键盘挂起，F2 后键盘归画板", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 100,
      height: 24,
    })
    await t.waitUntil(() => t.frame().includes("mock 就绪"), 12000)
    await t.type("counter")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("计数器"), 8000)

    // 输入行模式：Enter 不会触发画板按钮（挂起），只会发送空 prompt（被忽略）
    await t.enter()
    await t.settle()
    expect(t.frame()).not.toContain("count=1")

    // F2 进入页面模式：焦点落到画板按钮，Enter 触发 +1
    await t.press("\u001bOQ")
    await t.settle()
    await t.waitUntil(() => t.frame().includes("页面模式"), 2000)
    await t.enter()
    await t.waitUntil(() => t.frame().includes("count=1"), 8000)

    // Esc 返回输入行模式
    await t.escape()
    await t.waitUntil(() => t.frame().includes("输入模式"), 2000)
    t.destroy()
  }, 20000)

  test("F3 打开滚动对话面板查看完整回复，Esc 关闭", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 100,
      height: 24,
    })
    await t.waitUntil(() => t.frame().includes("mock 就绪"), 12000)
    await t.type("counter")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("已渲染计数器"), 8000)

    // F3：画板切换为对话记录面板，完整回复在面板中
    await t.press("\u001bOR")
    await t.waitUntil(() => t.frame().includes("对话记录"), 2000)
    expect(t.frame()).toContain("已渲染计数器（count=0）")

    // Esc 关闭面板回到画板
    await t.escape()
    await t.waitUntil(() => !t.frame().includes("对话记录"), 2000)
    expect(t.frame()).toContain("计数器")
    t.destroy()
  }, 20000)

  test("F3 日志层开启时，agent 页面快照仍等待并读取新 $ui 页面", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 100,
      height: 24,
    })
    await t.waitUntil(() => t.frame().includes("mock 就绪"), 12000)

    await t.type("snapshot-overlay")
    await t.enter()
    // mock agent 在 eval 后延迟截帧；期间由人类打开 F3 日志层。
    await t.press("\u001bOR")
    await t.waitUntil(() => t.frame().includes("对话记录"), 2000)
    await t.waitUntil(() => t.frame().includes("页面快照已确认"), 8000)
    // 页面快照的临时绘制不会改变人类原本开启的日志层。
    expect(t.frame()).toContain("对话记录")

    await t.escape()
    await t.waitUntil(() => t.frame().includes("快照页"), 2000)
    expect(t.frame()).toContain("页面新标记")
    t.destroy()
  }, 20000)

  test("流式 chunk 拼接成整行，不会一字一行", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 100,
      height: 24,
    })
    await t.waitUntil(() => t.frame().includes("mock 就绪"), 12000)

    // mock agent 会把这句话按字符逐个 chunk 发送
    await t.type("stream")
    await t.enter()
    // 轮次在途：状态行显示「运行中」
    await t.waitUntil(() => t.frame().includes("运行中"), 4000)
    await t.waitUntil(() => t.frame().includes("这是一段流式拼接的完整回复"), 8000)
    // 轮次结束：回到「空闲」
    await t.waitUntil(() => t.frame().includes("空闲"), 4000)

    // 对话面板里必须是完整一行，而不是每个字符各占一行
    await t.press("\u001bOR")
    await t.waitUntil(() => t.frame().includes("对话记录"), 2000)
    const lines = t.frame().split("\n")
    expect(lines.some((l) => l.includes("这是一段流式拼接的完整回复"))).toBe(true)
    // 单字符独占一行 = 拼接失败（帧里出现「 这 」这类孤行）
    expect(lines.some((l) => l.trim() === "这")).toBe(false)
    t.destroy()
  }, 20000)
})

describe("会话复用（--resume）", () => {
  test("session/load 恢复：历史经 update 回放进对话记录，可继续对话", async () => {
    const t = await renderTui(
      <VibeApp agentCmd={["bun", MOCK_AGENT]} resumeSessionId="mock-old" />,
      { width: 100, height: 24 },
    )

    // 恢复完成：历史回放已进入缓冲，引导应答到达
    await t.waitUntil(() => t.frame().includes("mock 就绪"), 12000)

    // F3 对话面板能看到回放的历史
    await t.press("\u001bOR")
    await t.waitUntil(() => t.frame().includes("对话记录"), 2000)
    expect(t.frame()).toContain("历史回答第一行")
    expect(t.frame()).toContain("历史回答第二行")
    await t.escape()

    // 恢复的会话可继续正常对话（prompt → 渲染页面）
    await t.type("counter")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("计数器"), 8000)
    t.destroy()
  }, 20000)
})

describe("全局退出（Esc×2）", () => {
  test("顶层第一次 Esc 提示，第二次触发退出回调；面板/页面模式的 Esc 不受影响", async () => {
    let quitted = false
    const t = await renderTui(
      <VibeApp agentCmd={["bun", MOCK_AGENT]} onQuit={() => (quitted = true)} />,
      { width: 100, height: 24 },
    )
    await t.waitUntil(() => t.frame().includes("mock 就绪"), 12000)

    // F3 面板里的 Esc 只关面板，不算退出计数
    await t.press("\u001bOR")
    await t.waitUntil(() => t.frame().includes("对话记录"), 2000)
    await t.escape()
    await t.waitUntil(() => !t.frame().includes("对话记录"), 2000)
    expect(quitted).toBe(false)

    // 顶层：第一次 Esc 提示，第二次退出
    await t.escape()
    await t.waitUntil(() => t.frame().includes("再按一次 Esc 退出"), 2000)
    expect(quitted).toBe(false)
    await t.escape()
    await t.waitUntil(() => quitted, 3000)
    t.destroy()
  }, 20000)
})

describe("$ui 活对象树 REPL", () => {
  test("agent 逐步搭活树 → 真函数点击回流 → 重建时清空旧内容", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 100,
      height: 24,
    })
    await t.waitUntil(() => t.frame().includes("mock 就绪"), 12000)

    await t.type("live")
    await t.enter()
    // 三步依次上屏：页面标题 → 按钮 → 第二块
    await t.waitUntil(() => t.frame().includes("活树页"), 8000)
    await t.waitUntil(() => t.frame().includes("触发"), 8000)
    await t.waitUntil(() => t.frame().includes("活树第二块"), 8000)

    // 真函数 handler：点击 → $agent.send("live-hit") 回流给 agent
    const pos = locate(t.frame(), "触发")
    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.waitUntil(() => t.frame().includes("收到 live-hit"), 8000)

    // 重建页面（counter 场景先 $ui.clear()）：旧活树内容消失
    await t.type("counter")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("当前计数"), 8000)
    expect(t.frame()).not.toContain("活树第二块")

    t.destroy()
  }, 20000)
})
