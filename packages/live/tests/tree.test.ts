import { describe, expect, test } from "bun:test"
import { LiveTree } from "../src/tree"

/**
 * 活对象树契约：操作级校验（非法抛错不改树）、结构操作、
 * name/default 数据绑定、watch/disposer、onMutate 时机。
 */

function makeTree() {
  let mutations = 0
  const tree = new LiveTree({ onMutate: () => (mutations += 1) })
  return { tree, ui: tree.ui, count: () => mutations }
}

describe("LiveTree × $ui", () => {
  test("add：自动 id 按组件递增，显式 id 冲突抛错", () => {
    const { ui } = makeTree()
    const a = ui.add("Button", { content: "A" })
    const b = ui.add("Button", { content: "B" })
    expect(a.id).toBe("button0")
    expect(b.id).toBe("button1")
    const c = ui.add("Typography.Text", { content: "文本" })
    expect(c.id).toBe("typographytext0")
    ui.add("Card", { id: "main" })
    expect(() => ui.add("Card", { id: "main" })).toThrow("已存在")
  })

  test("无配置的容器可省略 init 对象并继续嵌套", () => {
    const { ui } = makeTree()
    const space = ui.add("Space", { props: { wrap: true } })
    const row = space.add("Row")
    row.add("Divider")

    expect(ui.children.map((node) => node.component)).toEqual(["Space"])
    expect(space.props.wrap).toBe(true)
    expect(space.children.map((node) => node.component)).toEqual(["Row"])
    expect(row.children.map((node) => node.component)).toEqual(["Divider"])
  })

  test("List / List.Item / Typography.Link 可被活树组合", () => {
    const { ui } = makeTree()
    const list = ui.add("List", { props: { bordered: true } })
    list.add("List.Item", { content: "第一条" })
    const link = ui.add("Typography.Link", {
      content: "文档",
      props: { href: "https://ant.design", tuiOnClick: () => {} },
    })

    expect(list.children[0]?.component).toBe("List.Item")
    expect(link.props.href).toBe("https://ant.design")
  })

  test("未知组件 / 非法 prop 键：抛错且树不变", () => {
    const { ui } = makeTree()
    expect(() => ui.add("Evil")).toThrow("未知组件")
    expect(() => ui.add("Button", { props: { onclick: 1 } })).toThrow('不接受 prop "onclick"')
    expect(ui.children.length).toBe(0)
  })

  test("回调 prop 传 {{ }} 字符串：抛错（活树用真函数）", () => {
    const { ui } = makeTree()
    expect(() => ui.add("Button", { props: { tuiOnClick: "{{ () => run() }}" } })).toThrow(
      "真 JS 函数",
    )
    const btn = ui.add("Button")
    expect(() => {
      btn.props.tuiOnClick = "{{ () => run() }}"
    }).toThrow("真 JS 函数")
    const fn = () => {}
    btn.props.tuiOnClick = fn
    expect(btn.props.tuiOnClick).toBe(fn)
  })

  test("props 代理：非法键抛错、合法读写、delete", () => {
    const { ui } = makeTree()
    const btn = ui.add("Button", { props: { type: "primary" } })
    expect(() => {
      btn.props.percent = 50
    }).toThrow("不接受 prop")
    expect(btn.props.type).toBe("primary")
    btn.props.disabled = true
    expect(btn.props.disabled).toBe(true)
    delete btn.props.disabled
    expect("disabled" in btn.props).toBe(false)
    expect(Object.keys(btn.props)).toEqual(["type"])
  })

  test("remove：级联删除子树，句柄操作报节点不存在", () => {
    const { ui } = makeTree()
    const card = ui.add("Card", { id: "card" })
    const row = card.add("Row", { id: "row" })
    row.add("Button", { id: "btn" })
    card.remove()
    expect(ui.has("card")).toBe(false)
    expect(ui.has("btn")).toBe(false)
    expect(() => row.props.gutter).toThrow("不存在")
    expect(() => ui.get("btn")).toThrow("节点不存在")
  })

  test("insert 定位与 moveTo：跨父移动、移入自身子树抛错", () => {
    const { ui } = makeTree()
    const a = ui.add("Card", { id: "a" })
    const b = ui.add("Card", { id: "b" })
    const text = a.add("Typography.Text", { id: "t", content: "内容" })
    ui.insert(0, "Divider", { id: "d" })
    expect(ui.children.map((n) => n.id)).toEqual(["d", "a", "b"])

    text.moveTo(b)
    expect(a.children.length).toBe(0)
    expect(b.children.map((n) => n.id)).toEqual(["t"])
    expect(text.parent?.id).toBe("b")

    text.moveTo(null, 0)
    expect(ui.children.map((n) => n.id)).toEqual(["t", "d", "a", "b"])

    expect(() => a.moveTo(a)).toThrow("自身或其后代")
    const inner = a.add("Row", { id: "inner" })
    expect(() => a.moveTo(inner)).toThrow("自身或其后代")
  })

  test("name 绑定：仅输入组件与 Typography.Text；default 不覆盖已有值", () => {
    const { ui } = makeTree()
    expect(() => ui.add("Card", { name: "x" })).toThrow("不支持 name 绑定")
    ui.add("Input", { name: "keyword", default: "初始" })
    expect(ui.data.keyword).toBe("初始")
    ui.add("Typography.Text", { name: "keyword", default: "不应覆盖" })
    expect(ui.data.keyword).toBe("初始")
  })

  test("watch：数据变更触发回调，disposer 与 clear 都能注销", () => {
    const { ui } = makeTree()
    const seen: unknown[] = []
    const dispose = ui.watch(
      () => ui.data.n,
      (value) => seen.push(value),
    )
    ui.data.n = 1
    expect(seen).toEqual([1])
    dispose()
    ui.data.n = 2
    expect(seen).toEqual([1])

    const seen2: unknown[] = []
    ui.watch(
      () => ui.data.m,
      (value) => seen2.push(value),
    )
    ui.clear()
    ui.data.m = 3
    expect(seen2).toEqual([])
  })

  test("clear：清树、清 data；onMutate 只在结构/props 变更时触发", () => {
    const { ui, count } = makeTree()
    ui.page({ title: "标题" })
    const btn = ui.add("Button")
    btn.props.disabled = true
    btn.content = "文案"
    expect(count()).toBe(4)

    ui.data.free = 1
    expect(count()).toBe(4)

    ui.clear()
    expect(count()).toBe(4)
    expect(ui.children.length).toBe(0)
    expect("free" in ui.data).toBe(false)
  })

  test("toJSON：函数值以占位符回显（MCP stringify 安全）", () => {
    const { ui } = makeTree()
    const btn = ui.add("Button", { content: "跑", props: { tuiOnClick: () => {} } })
    const json = JSON.parse(JSON.stringify(btn)) as Record<string, unknown>
    expect(json.component).toBe("Button")
    expect(json.content).toBe("跑")
    expect((json.props as Record<string, unknown>).tuiOnClick).toBe("[function]")
  })

  test("inspectLayout：报告 Row 默认换行与可静态判定的栅格风险", () => {
    const { tree, ui } = makeTree()
    const row = ui.add("Row", { id: "grid", props: { gutter: 2 } })
    row.add("Col", { id: "auto" })
    row.add("Col", { id: "wide", props: { span: 16, offset: 12 } })
    row.add("Col", { id: "fixed", props: { style: { width: 20 } } })

    const inspection = tree.inspectLayout({ width: 18, height: 8 })
    expect(inspection.viewport).toEqual({ width: 18, height: 8 })
    expect(inspection.nodes.find((node) => node.id === "grid")?.layout).toMatchObject({
      gutter: 2,
      wrap: true,
      width: "100%",
    })
    expect(inspection.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["row-wrap", "auto-width-col", "span-overflow", "fixed-width-overflow"]),
    )
  })

  test("inspect：说明 Alert 的主文案 props 与 content children 的不同语义", () => {
    const { tree, ui } = makeTree()
    ui.add("Alert", {
      id: "notice",
      content: "作为 children 的补充内容",
      props: { message: "主文案", description: "说明" },
    })

    expect(tree.inspect("notice")).toEqual([
      expect.objectContaining({
        id: "notice",
        props: { message: "主文案", description: "说明" },
        text: { content: "children", primaryProp: "message", secondaryProp: "description" },
      }),
    ])
  })
  test("叶子组件拒绝子节点:add 与 moveTo 均抛错并提示容器列表", () => {
    const tree = new LiveTree()
    const ui = tree.ui
    const text = ui.add("Typography.Text", { content: "叶子" })
    expect(() => text.add("Typography.Title", { content: "被吞" })).toThrow(/叶子组件.*不接受子节点/)
    // 链式误用场景:错误信息里带修正指引
    expect(() => ui.add("Button", { content: "按钮" }).add("Tag", { content: "x" })).toThrow(
      /node\.add\(\) 返回新建节点/,
    )
    const tag = ui.add("Tag", { content: "标签" })
    expect(() => tag.moveTo(text)).toThrow(/叶子组件/)
    // 容器不受影响
    const card = ui.add("Card")
    card.add("Typography.Text", { content: "a" })
    card.add("Typography.Text", { content: "b" })
    expect(card.children.length).toBe(2)
    tag.moveTo(card)
    expect(card.children.length).toBe(3)
  })

})
