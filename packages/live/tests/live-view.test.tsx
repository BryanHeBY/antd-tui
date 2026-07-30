import { describe, expect, test } from "bun:test"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope, displayWidth } from "@antd-tui/components"
import { LiveTree } from "../src/tree"
import { LiveView } from "../src/LiveView"
import { buildCalculator } from "../../../examples/repl/calculator"

/**
 * LiveView 渲染契约：$ui 每步操作即时上屏（observable 自驱）、
 * 真函数回调、props 热换、name↔data 双向绑定、增量插入不丢已有输入。
 */

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

async function mount(tree: LiveTree) {
  return renderTui(
    <ConfigProvider>
      <FocusScope>
        <LiveView tree={tree} hideHint />
      </FocusScope>
    </ConfigProvider>,
    { width: 80, height: 24 },
  )
}

describe("LiveView × $ui", () => {
  test("挂起/恢复页面 FocusScope 后，滚动内容仍保留完整可用宽度", async () => {
    const { useState } = await import("react")
    const tree = new LiveTree()
    buildCalculator(tree.ui)
    let setPageMode: (value: boolean) => void = () => {}

    function Demo() {
      const [pageMode, setMode] = useState(false)
      setPageMode = setMode
      return (
        <ConfigProvider>
          <FocusScope>
            <box style={{ width: "100%", height: "100%", flexDirection: "column" }}>
              <box style={{ flexGrow: 1, flexShrink: 1, flexDirection: "column" }}>
                <FocusScope suspended={!pageMode}>
                  <LiveView tree={tree} hideHint handleEscape={false} />
                </FocusScope>
              </box>
            </box>
          </FocusScope>
        </ConfigProvider>
      )
    }

    const t = await renderTui(<Demo />, { width: 80, height: 24 })
    const wideX = locate(t.frame(), "÷").x
    expect(wideX).toBeGreaterThan(55)

    // 对应 vibe-tui F2 的连续页面模式切换。
    setPageMode(true)
    await t.settle()
    setPageMode(false)
    await t.settle()
    setPageMode(true)
    await t.settle()
    expect(locate(t.frame(), "÷").x).toBeGreaterThan(55)
    t.destroy()
  }, 20000)

  test("逐步 add 即时上屏；中途插入兄弟不丢已有输入", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    const t = await mount(tree)

    ui.page({ title: "增量页" })
    await t.settle()
    expect(t.frame()).toContain("增量页")

    ui.add("Input", { name: "keyword" })
    await t.settle()
    await t.type("abc")
    expect(ui.data.keyword).toBe("abc")

    ui.insert(0, "Typography.Text", { id: "tip", content: "第一块" })
    await t.settle()
    expect(t.frame()).toContain("第一块")
    expect(t.frame()).toContain("abc")
    expect(ui.data.keyword).toBe("abc")

    t.destroy()
  }, 20000)

  test("Button 真函数点击；props 热换新函数即刻生效", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    const t = await mount(tree)

    const hits: string[] = []
    const btn = ui.add("Button", { content: "运行", props: { tuiOnClick: () => hits.push("旧") } })
    await t.settle()

    const pos = locate(t.frame(), "运行")
    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.settle()
    expect(hits).toEqual(["旧"])

    btn.props.tuiOnClick = () => hits.push("新")
    await t.settle()
    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.settle()
    expect(hits).toEqual(["旧", "新"])

    t.destroy()
  }, 20000)

  test("Typography.Text name 单向显示随 $ui.data 联动；watch 触发", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    const t = await mount(tree)

    ui.add("Typography.Text", { name: "display", default: "0" })
    await t.settle()
    expect(t.frame()).toContain("0")

    const seen: unknown[] = []
    ui.watch(
      () => ui.data.display,
      (value) => seen.push(value),
    )
    ui.data.display = "42"
    await t.settle()
    expect(t.frame()).toContain("42")
    expect(seen).toEqual(["42"])

    t.destroy()
  }, 20000)

  test("List.Item 与 Typography.Link 在活树中按子节点渲染并响应点击", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    const t = await mount(tree)

    const list = ui.add("List", { props: { bordered: true }, id: "results" })
    list.add("List.Item", { content: "第一条结果" })
    const clicks: string[] = []
    ui.add("Typography.Link", {
      content: "查看文档",
      props: { href: "https://ant.design", tuiOnClick: () => clicks.push("docs") },
    })
    await t.settle()
    expect(t.frame()).toContain("第一条结果")
    expect(t.frame()).toContain("查看文档")

    const pos = locate(t.frame(), "查看文档")
    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.settle()
    expect(clicks).toEqual(["docs"])
    t.destroy()
  }, 20000)

  test("props 热更（Progress percent）与 remove 即时上屏", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    const t = await mount(tree)

    const bar = ui.add("Progress", { props: { percent: 10 } })
    const tip = ui.add("Typography.Text", { id: "tip", content: "加载中" })
    await t.settle()
    expect(t.frame()).toContain("10%")
    expect(t.frame()).toContain("加载中")

    bar.props.percent = 60
    await t.settle()
    expect(t.frame()).toContain("60%")

    tip.remove()
    await t.settle()
    expect(t.frame()).not.toContain("加载中")

    t.destroy()
  }, 20000)

  test("onChange 命名差异组件（Checkbox）双向绑定", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    const t = await mount(tree)

    ui.add("Checkbox", { name: "agree", content: "同意条款" })
    await t.settle()

    const pos = locate(t.frame(), "同意条款")
    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.settle()
    expect(ui.data.agree).toBe(true)

    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.settle()
    expect(ui.data.agree).toBe(false)

    t.destroy()
  }, 20000)

  test("Esc 默认与 PageView 一致：完成回传；$ui.escape 可覆盖与去除", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    const finishes: unknown[] = []
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <LiveView tree={tree} onFinish={(values) => finishes.push(values)} />
        </FocusScope>
      </ConfigProvider>,
      { width: 80, height: 24 },
    )

    ui.page({ title: "退出测试", mode: "interactive" })
    ui.data.n = 7
    await t.settle()
    expect(t.frame()).toContain("Esc 退出")

    // 默认：Esc = 完成回传 $ui.data 快照
    await t.escape()
    expect(finishes).toEqual([{ n: 7 }])

    // 覆盖：走自定义处理器，不再触发 onFinish
    const custom: string[] = []
    ui.escape(() => custom.push("hit"))
    await t.escape()
    expect(custom).toEqual(["hit"])
    expect(finishes.length).toBe(1)

    // 去除：Esc 静默，提示行隐去 Esc 段
    ui.escape(null)
    await t.settle()
    expect(t.frame()).not.toContain("Esc 退出")
    await t.escape()
    expect(custom.length).toBe(1)
    expect(finishes.length).toBe(1)

    // 恢复默认
    ui.escape()
    await t.escape()
    expect(finishes.length).toBe(2)

    t.destroy()
  }, 20000)

  test("box 容器上的 content 自动包成文本，不崩溃", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    ui.page({ title: "容器文本", mode: "interactive" })
    ui.add("Card", { content: "卡片说明文字" })
    ui.add("Space", { content: "间距容器文字" })
    ui.add("Flex", { content: "弹性容器文字" })
    // 文本安全组件保持原样直传（Button 自己渲染文案）
    ui.add("Button", { content: "按钮文案" })

    const t = await mount(tree)
    const frame = t.frame()
    expect(frame).toContain("卡片说明文字")
    expect(frame).toContain("间距容器文字")
    expect(frame).toContain("弹性容器文字")
    expect(frame).toContain("按钮文案")
    t.destroy()
  }, 20000)

  test("回调抛错走 onCallbackError 兜底，不穿透事件派发链", async () => {
    const errors: Array<{ context: string; message: string }> = []
    const tree = new LiveTree({
      onCallbackError: (error, context) =>
        errors.push({ context, message: (error as Error).message }),
    })
    const ui = tree.ui
    ui.page({ title: "守卫", mode: "interactive" })
    ui.add("Button", {
      id: "boom",
      content: "  炸  ",
      props: {
        tuiOnClick: () => {
          ui.get("不存在的节点")
        },
      },
    })

    const t = await mount(tree)
    const pos = locate(t.frame(), "  炸  ")
    await t.raw.mockMouse.click(pos.x, pos.y)
    await t.settle()

    expect(errors.length).toBe(1)
    expect(errors[0]!.context).toBe("boom.tuiOnClick")
    expect(errors[0]!.message).toContain("节点不存在")
    // 宿主仍存活可渲染
    expect(t.frame()).toContain("炸")

    // watch 回调抛错同样兜底
    ui.add("Input", { name: "n" })
    ui.watch(
      () => tree.data.n,
      () => {
        throw new Error("watch 崩了")
      },
    )
    tree.data.n = "x"
    expect(errors.length).toBe(2)
    expect(errors[1]!.context).toBe("$ui.watch 回调")
    t.destroy()
  }, 20000)

  test("clear 后同 tick 重建：撞 id 也不残留旧内容", async () => {
    const tree = new LiveTree()
    const ui = tree.ui
    ui.page({ title: "旧页", mode: "interactive" })
    ui.add("Typography.Text", { content: "旧内容A" })
    ui.add("Button", { content: "旧按钮B" })

    const t = await mount(tree)
    expect(t.frame()).toContain("旧内容A")

    // agent 一次 eval 里换页：clear + 重建同步完成；
    // 自动 id 计数重置后新节点与旧节点同 id（typographytext0）
    ui.clear()
    ui.page({ title: "新页", mode: "interactive" })
    ui.add("Typography.Text", { content: "新内容C" })

    await t.settle()
    const frame = t.frame()
    expect(frame).toContain("新内容C")
    expect(frame).not.toContain("旧内容A")
    expect(frame).not.toContain("旧按钮B")
    t.destroy()
  }, 20000)

  test("Modal 与 Typography.Title 可经 $ui 使用", async () => {
    const cancels: string[] = []
    const tree = new LiveTree()
    const ui = tree.ui
    ui.page({ title: "浮层页", mode: "interactive" })
    ui.add("Typography.Title", { content: "小节标题" })
    ui.add("Modal", {
      id: "dlg",
      content: "确认要继续吗",
      props: { open: true, title: "确认", tuiOnCancel: () => cancels.push("hit") },
    })

    const t = await mount(tree)
    const frame = t.frame()
    expect(frame).toContain("小节标题")
    expect(frame).toContain("确认要继续吗")
    expect(frame).toContain("确定")

    // 热换 open 关闭浮层
    ui.get("dlg").props.open = false
    await t.settle()
    expect(t.frame()).not.toContain("确认要继续吗")
    t.destroy()
  }, 20000)
})
