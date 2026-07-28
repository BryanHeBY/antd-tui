import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider, Table } from "../src"

/**
 * Table：列宽自适应 / 固定宽度截断 / 对齐 / 自定义渲染 / 空态。
 */

function wrap(node: ReactNode) {
  return <ConfigProvider>{node}</ConfigProvider>
}

const columns = [
  { title: "姓名", dataIndex: "name", key: "name" },
  { title: "年龄", dataIndex: "age", key: "age", align: "right" as const },
]

const dataSource = [
  { id: "1", name: "张三", age: 28 },
  { id: "2", name: "李四", age: 32 },
]

describe("Table", () => {
  test("渲染表头、分隔线与数据行", async () => {
    const t = await renderTui(
      wrap(<Table columns={columns} dataSource={dataSource} rowKey="id" />),
      { width: 40, height: 8 },
    )
    const frame = t.frame()
    expect(frame).toContain("姓名")
    expect(frame).toContain("年龄")
    expect(frame).toContain("─")
    expect(frame).toContain("张三")
    expect(frame).toContain("李四")
    expect(frame).toContain("28")
    t.destroy()
  })

  test("列宽自适应：最长内容决定列宽，同列左对齐", async () => {
    const t = await renderTui(
      wrap(
        <Table
          columns={[{ title: "值", dataIndex: "v", key: "v" }]}
          dataSource={[{ v: "a" }, { v: "long-value" }]}
        />,
      ),
      { width: 40, height: 8 },
    )
    const lines = t.frame().split("\n")
    const shortLine = lines.find((l) => l.includes("a  "))
    const longLine = lines.find((l) => l.includes("long-value"))
    expect(shortLine).toBeDefined()
    expect(longLine).toBeDefined()
    t.destroy()
  })

  test("width 固定列宽，超长内容截断为省略号", async () => {
    const t = await renderTui(
      wrap(
        <Table
          columns={[{ title: "标题", dataIndex: "text", key: "text", width: 6 }]}
          dataSource={[{ text: "abcdefghijk" }]}
        />,
      ),
      { width: 30, height: 6 },
    )
    expect(t.frame()).toContain("abcde…")
    expect(t.frame()).not.toContain("abcdefg")
    t.destroy()
  })

  test("align=right 右对齐数值", async () => {
    const t = await renderTui(
      wrap(
        <Table
          columns={[{ title: "数量", dataIndex: "n", key: "n", width: 6, align: "right" }]}
          dataSource={[{ n: 7 }]}
        />,
      ),
      { width: 30, height: 6 },
    )
    const line = t
      .frame()
      .split("\n")
      .find((l) => l.includes("7"))!
    // 右对齐：数字前有空白填充
    expect(line.indexOf("7")).toBeGreaterThan(1)
    t.destroy()
  })

  test("tuiRender 自定义单元格内容", async () => {
    const t = await renderTui(
      wrap(
        <Table
          columns={[
            {
              title: "状态",
              dataIndex: "done",
              key: "done",
              tuiRender: (value) => (value ? "已完成" : "进行中"),
            },
          ]}
          dataSource={[{ done: true }, { done: false }]}
        />,
      ),
      { width: 30, height: 8 },
    )
    expect(t.frame()).toContain("已完成")
    expect(t.frame()).toContain("进行中")
    t.destroy()
  })

  test("bordered 使用竖线分隔列", async () => {
    const t = await renderTui(
      wrap(<Table bordered columns={columns} dataSource={dataSource} rowKey="id" />),
      { width: 40, height: 8 },
    )
    expect(t.frame()).toContain("│")
    expect(t.frame()).toContain("┼")
    t.destroy()
  })

  test("空数据显示占位文案", async () => {
    const t = await renderTui(wrap(<Table columns={columns} dataSource={[]} />), {
      width: 30,
      height: 6,
    })
    expect(t.frame()).toContain("暂无数据")
    t.destroy()
  })
})
