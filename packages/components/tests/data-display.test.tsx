import { describe, expect, test } from "bun:test"
import type { ReactNode } from "react"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider, Descriptions, Progress, Spin, Statistic } from "../src"

/**
 * 数据展示类组件：Progress / Statistic / Descriptions / Spin。
 */

function wrap(node: ReactNode) {
  return <ConfigProvider>{node}</ConfigProvider>
}

describe("Progress", () => {
  test("percent 决定填充比例并显示百分比", async () => {
    const t = await renderTui(wrap(<Progress percent={50} />), { width: 30, height: 4 })
    const frame = t.frame()
    expect(frame).toContain("50%")
    expect(frame).toContain("█")
    expect(frame).toContain("░")
    t.destroy()
  })

  test("percent 100 自动转 success 态显示 ✓", async () => {
    const t = await renderTui(wrap(<Progress percent={100} />), { width: 30, height: 4 })
    expect(t.frame()).toContain("✓")
    expect(t.frame()).not.toContain("░")
    t.destroy()
  })

  test("exception 状态显示 ✗", async () => {
    const t = await renderTui(wrap(<Progress percent={40} status="exception" />), {
      width: 30,
      height: 4,
    })
    expect(t.frame()).toContain("✗")
    t.destroy()
  })

  test("showInfo=false 不显示右侧信息，越界值被裁剪", async () => {
    const t = await renderTui(wrap(<Progress percent={150} showInfo={false} />), {
      width: 30,
      height: 4,
    })
    expect(t.frame()).not.toContain("%")
    expect(t.frame()).not.toContain("░")
    t.destroy()
  })
})

describe("Statistic", () => {
  test("title/value 与前后缀上屏", async () => {
    const t = await renderTui(
      wrap(<Statistic title="活跃用户" value={1128} prefix="↑" suffix="人" />),
      { width: 30, height: 5 },
    )
    const frame = t.frame()
    expect(frame).toContain("活跃用户")
    expect(frame).toContain("1128")
    expect(frame).toContain("↑")
    expect(frame).toContain("人")
    t.destroy()
  })

  test("precision 控制小数位", async () => {
    const t = await renderTui(wrap(<Statistic value={3.14159} precision={2} />), {
      width: 30,
      height: 4,
    })
    expect(t.frame()).toContain("3.14")
    t.destroy()
  })

  test("value 缺省显示占位", async () => {
    const t = await renderTui(wrap(<Statistic title="空值" />), { width: 30, height: 5 })
    expect(t.frame()).toContain("-")
    t.destroy()
  })
})

describe("Descriptions", () => {
  test("items 渲染标签与值，title 上屏", async () => {
    const t = await renderTui(
      wrap(
        <Descriptions
          title="用户信息"
          items={[
            { key: "name", label: "姓名", children: "张三" },
            { key: "age", label: "年龄", children: 28 },
          ]}
        />,
      ),
      { width: 40, height: 8 },
    )
    const frame = t.frame()
    expect(frame).toContain("用户信息")
    expect(frame).toContain("姓名: 张三")
    expect(frame).toContain("年龄: 28")
    t.destroy()
  })

  test("column 控制每行项数", async () => {
    const t = await renderTui(
      wrap(
        <Descriptions
          column={2}
          items={[
            { key: "a", label: "甲", children: "1" },
            { key: "b", label: "乙", children: "2" },
          ]}
        />,
      ),
      { width: 40, height: 6 },
    )
    // 同一行同时包含两项
    const line = t
      .frame()
      .split("\n")
      .find((l) => l.includes("甲"))!
    expect(line).toContain("乙")
    t.destroy()
  })

  test("bordered 渲染外框", async () => {
    const t = await renderTui(
      wrap(<Descriptions bordered items={[{ key: "k", label: "键", children: "值" }]} />),
      { width: 30, height: 6 },
    )
    expect(t.frame()).toContain("╭")
    t.destroy()
  })
})

describe("Spin", () => {
  test("spinning 渲染动画帧并随时间推进", async () => {
    const t = await renderTui(wrap(<Spin tip="加载中" tuiIntervalMs={10} />), {
      width: 30,
      height: 4,
    })
    expect(t.frame()).toContain("加载中")
    const first = t.frame()
    await t.waitUntil(() => t.frame() !== first)
    t.destroy()
  })

  test("spinning=false 直接渲染子节点", async () => {
    const t = await renderTui(
      wrap(
        <Spin spinning={false}>
          <text>内容已就绪</text>
        </Spin>,
      ),
      { width: 30, height: 4 },
    )
    expect(t.frame()).toContain("内容已就绪")
    t.destroy()
  })

  test("spinning 时保留子节点并显示加载提示", async () => {
    const t = await renderTui(
      wrap(
        <Spin tip="正在加载">
          <text>后台内容</text>
        </Spin>,
      ),
      { width: 30, height: 4 },
    )
    expect(t.frame()).toContain("正在加载")
    expect(t.frame()).toContain("后台内容")
    t.destroy()
  })
})
