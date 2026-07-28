import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderTui } from "@antd-tui/test-utils"
import { Alert, ConfigProvider, Divider, Tag } from "../src"

/**
 * 展示类组件：Alert / Tag / Divider（纯渲染，无交互）。
 */

function wrap(node: ReactNode) {
  return <ConfigProvider>{node}</ConfigProvider>
}

describe("Alert", () => {
  test("message 与 description 上屏，showIcon 渲染类型图标", async () => {
    const t = await renderTui(
      wrap(<Alert type="success" showIcon message="操作成功" description="数据已保存" />),
      { width: 40, height: 6 },
    )
    const frame = t.frame()
    expect(frame).toContain("操作成功")
    expect(frame).toContain("数据已保存")
    expect(frame).toContain("✓")
    t.destroy()
  })

  test("各类型图标：info/warning/error", async () => {
    for (const [type, icon] of [
      ["info", "i"],
      ["warning", "!"],
      ["error", "✗"],
    ] as const) {
      const t = await renderTui(wrap(<Alert type={type} showIcon message="提示" />), {
        width: 30,
        height: 4,
      })
      expect(t.frame()).toContain(icon)
      t.destroy()
    }
  })

  test("showIcon 为 false 时不渲染图标", async () => {
    const t = await renderTui(wrap(<Alert type="success" message="无图标" />), {
      width: 30,
      height: 4,
    })
    expect(t.frame()).toContain("无图标")
    expect(t.frame()).not.toContain("✓")
    t.destroy()
  })
})

describe("Tag", () => {
  test("bordered 渲染方括号包裹", async () => {
    const t = await renderTui(wrap(<Tag color="green">已完成</Tag>), { width: 30, height: 4 })
    expect(t.frame()).toContain("[已完成]")
    t.destroy()
  })

  test("bordered=false 渲染色块（无方括号）", async () => {
    const t = await renderTui(
      wrap(
        <Tag color="blue" bordered={false}>
          进行中
        </Tag>,
      ),
      { width: 30, height: 4 },
    )
    expect(t.frame()).toContain("进行中")
    expect(t.frame()).not.toContain("[进行中]")
    t.destroy()
  })
})

describe("Divider", () => {
  test("无文字时渲染整行分割线", async () => {
    const t = await renderTui(wrap(<Divider />), { width: 20, height: 4 })
    const line = t
      .frame()
      .split("\n")
      .find((l) => l.includes("─"))
    expect(line).toBeDefined()
    t.destroy()
  })

  test("dashed 使用虚线字符", async () => {
    const t = await renderTui(wrap(<Divider dashed />), { width: 20, height: 4 })
    expect(t.frame()).toContain("╌")
    t.destroy()
  })

  test("带文字时嵌入分割线，orientation 控制位置", async () => {
    const left = await renderTui(wrap(<Divider orientation="left">标题</Divider>), {
      width: 30,
      height: 4,
    })
    const leftLine = left
      .frame()
      .split("\n")
      .find((l) => l.includes("标题"))!
    expect(leftLine).toContain("─")
    left.destroy()

    const right = await renderTui(wrap(<Divider orientation="right">标题</Divider>), {
      width: 30,
      height: 4,
    })
    const rightLine = right
      .frame()
      .split("\n")
      .find((l) => l.includes("标题"))!
    // 右对齐时文字前的分割线更长
    expect(rightLine.indexOf("标题")).toBeGreaterThan(leftLine.indexOf("标题"))
    right.destroy()
  })
})
