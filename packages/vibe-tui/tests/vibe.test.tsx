import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { renderTui } from "@antd-tui/test-utils"
import { displayWidth } from "@antd-tui/components"
import { VibeApp } from "../src/VibeApp"

/**
 * vibe-tui × mock agent 的闭环 E2E：
 * 输入 prompt → agent 经 _vibetui/render 下发页面 → 画板渲染 →
 * 鼠标点按钮触发 $agent.send 回流 → agent 重渲染 → 帧更新。
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
  test("prompt 生成页面 → 点击回流 → agent 重渲染", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 70,
      height: 24,
    })

    // agent 子进程握手完成
    await t.waitUntil(() => t.frame().includes("agent 就绪"), 8000)
    expect(t.frame()).toContain("画板空白")

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
  })

  test("输入行模式下画板键盘挂起，F2 后键盘归画板", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 70,
      height: 24,
    })
    await t.waitUntil(() => t.frame().includes("agent 就绪"), 8000)
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
  })

  test("F3 打开滚动对话面板查看完整回复，Esc 关闭", async () => {
    const t = await renderTui(<VibeApp agentCmd={["bun", MOCK_AGENT]} />, {
      width: 70,
      height: 24,
    })
    await t.waitUntil(() => t.frame().includes("agent 就绪"), 8000)
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
  })
})
