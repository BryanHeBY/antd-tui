import { describe, expect, test } from "bun:test"
import { renderTui } from "@antd-tui/test-utils"
import { App } from "../src/App"
import type { PageSchema } from "../src/validate"
import calculatorSchema from "../../../examples/calculator.schema.json"

/**
 * E2E（进程内）：手机风格计算器（逻辑全在 schema，page.mode = interactive）。
 * 覆盖热键输入、= 求值、错误分支、方向键导航、鼠标点击、Esc 完成回传。
 */

const schema = calculatorSchema as unknown as PageSchema

function render(onFinish: (v: Record<string, unknown>) => void, onCancel: () => void = () => {}) {
  return renderTui(<App schema={schema} onFinish={onFinish} onCancel={onCancel} />, {
    width: 60,
    height: 24,
  })
}

/** 在字符帧中找目标文本坐标（用于鼠标点击） */
function locate(frame: string, target: string): { x: number; y: number } {
  const lines = frame.split("\n")
  for (let y = 0; y < lines.length; y++) {
    const x = lines[y]!.indexOf(target)
    if (x >= 0) return { x, y }
  }
  throw new Error(`帧中找不到 "${target}"`)
}

describe("计算器 E2E", () => {
  test("热键输入 12+34×5，= 求值 182，Esc 完成回传", async () => {
    let finished: Record<string, unknown> | null = null
    const t = await render((v) => (finished = v))

    const frame0 = t.frame()
    expect(frame0).toContain("TUI 计算器")
    expect(frame0).toContain("AC")
    // actions 为空：不渲染提交/取消按钮
    expect(frame0).not.toContain("提交")
    expect(frame0).not.toContain("取消")

    await t.type("12+34*5")
    await t.waitUntil(() => t.frame().includes("12+34×5"))

    await t.type("=")
    await t.waitUntil(() => t.frame().includes("182"))

    await t.escape()
    await t.waitUntil(() => finished !== null)
    expect(finished!).toEqual({ display: "182" })
    t.destroy()
  })

  test("方向键导航 + Enter 按下按键", async () => {
    const t = await render(() => {})

    // 初始焦点 AC，向下到 7，Enter 输入
    await t.press("\u001b[B")
    await t.enter()
    await t.waitUntil(() => {
      const lines = t.frame().split("\n")
      // 显示行出现 7（右对齐，行内 7 与按键区分开）
      return lines.some((l) => l.trimEnd().endsWith("7 │"))
    })

    // 向右到 8，Enter → 78
    await t.press("\u001b[C")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("78"))
    t.destroy()
  })

  test("除以 0 显示错误，AC 热键复位", async () => {
    const t = await render(() => {})

    await t.type("1/0=")
    await t.waitUntil(() => t.frame().includes("错误"))

    await t.type("c")
    await t.waitUntil(() => !t.frame().includes("错误"))
    t.destroy()
  })

  test("DEL 热键退格", async () => {
    const t = await render(() => {})

    await t.type("78")
    await t.waitUntil(() => t.frame().includes("78"))
    await t.press("backspace")
    await t.waitUntil(() => !t.frame().includes("78"))
    t.destroy()
  })

  test("鼠标点击按钮输入", async () => {
    const t = await render(() => {})

    const pos = locate(t.frame(), "9")
    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.settle()
    await t.waitUntil(() => {
      // 显示屏右对齐出现 9：帧中 9 的出现次数增加
      const count = t.frame().split("9").length - 1
      return count >= 2
    })
    t.destroy()
  })

  test("Esc 直接退出也回传当前值（不触发 cancel）", async () => {
    let finished: Record<string, unknown> | null = null
    let cancelled = false
    const t = await render(
      (v) => (finished = v),
      () => (cancelled = true),
    )

    await t.escape()
    await t.waitUntil(() => finished !== null)
    expect(finished!).toEqual({ display: "0" })
    expect(cancelled).toBe(false)
    t.destroy()
  })
})
