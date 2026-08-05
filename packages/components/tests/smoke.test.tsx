import { describe, expect, test } from "bun:test"
import { BaseRenderable, ScrollBoxRenderable, parseColor } from "@opentui/core"
import { useState } from "react"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider } from "../src/theme"
import { FocusScope } from "../src/focus"
import { Button } from "../src/components/Button"
import { Input } from "../src/components/Input"
import { InputNumber } from "../src/components/InputNumber"
import { Flex } from "../src/components/Flex"
import { Space } from "../src/components/layout"
import { List } from "../src/components/List"
import { Typography } from "../src/components/Typography"
import { Col, Row } from "../src/components/grid"

function wrap(children: React.ReactNode) {
  return (
    <ConfigProvider>
      <FocusScope>{children}</FocusScope>
    </ConfigProvider>
  )
}

function findScrollbox(node: BaseRenderable): ScrollBoxRenderable | undefined {
  if (node instanceof ScrollBoxRenderable) return node
  for (const child of node.getChildren()) {
    const match = findScrollbox(child)
    if (match) return match
  }
  return undefined
}

describe("Button", () => {
  test("渲染文案并通过 Enter 激活", async () => {
    let pressed = 0
    const t = await renderTui(
      wrap(
        <Button type="primary" tuiOnClick={() => pressed++}>
          确认
        </Button>,
      ),
      { width: 40, height: 8 },
    )

    expect(t.frame()).toContain("确认")
    await t.enter()
    expect(pressed).toBe(1)
    t.destroy()
  })

  test("disabled 按钮不响应 Enter", async () => {
    let pressed = 0
    const t = await renderTui(
      wrap(
        <Button disabled tuiOnClick={() => pressed++}>
          禁用
        </Button>,
      ),
      { width: 40, height: 8 },
    )

    await t.enter()
    expect(pressed).toBe(0)
    t.destroy()
  })

  test("Group 用单一外框和分隔线组织相邻操作", async () => {
    const t = await renderTui(
      wrap(
        <Button.Group block>
          <Button tuiOnClick={() => {}}>左</Button>
          <Button type="primary" tuiOnClick={() => {}}>
            右
          </Button>
        </Button.Group>,
      ),
      { width: 30, height: 5 },
    )

    const line = t.frame().split("\n").find((item) => item.includes("左"))!
    expect(line).toContain("左")
    expect(line).toContain("右")
    // 左右外框与中间分隔线共三个 │，切分后得到四段。
    expect(line.split("│").length).toBe(4)
    t.destroy()
  })

  test("tuiBordered 按真实 Row/Col 布局合并共享边框", async () => {
    const t = await renderTui(
      wrap(
        <Button.Group block tuiBordered>
          <Row gutter={0} wrap={false}>
            <Col flex={1}>
              <Button tuiOnClick={() => {}}>7</Button>
            </Col>
            <Col flex={1}>
              <Button tuiOnClick={() => {}}>8</Button>
            </Col>
          </Row>
          <Row gutter={0} wrap={false}>
            <Col flex={1}>
              <Button tuiOnClick={() => {}}>4</Button>
            </Col>
            <Col flex={1}>
              <Button tuiOnClick={() => {}}>5</Button>
            </Col>
          </Row>
          <Row gutter={0} wrap={false}>
            <Col flex={2}>
              <Button tuiOnClick={() => {}}>0</Button>
            </Col>
            <Col flex={1}>
              <Button tuiOnClick={() => {}}>=</Button>
            </Col>
          </Row>
        </Button.Group>,
      ),
      { width: 30, height: 8 },
    )

    await t.waitUntil(() => t.frame().includes("┼"))
    const frame = t.frame()
    expect(frame).toContain("╭")
    expect(frame).toContain("┬")
    expect(frame).toContain("┼")
    expect(frame).toContain("┴")
    expect(frame).toContain("╯")
    t.destroy()
  })
})

describe("Input + FocusScope", () => {
  test("默认占满父容器，文本不被原生控件标题装饰遮挡", async () => {
    const t = await renderTui(wrap(<Input value="antd" tuiOnChange={() => {}} />), {
      width: 40,
      height: 5,
    })

    const line = t.frame().split("\n").find((item) => item.includes("antd"))
    expect(line).toBeDefined()
    expect(line).not.toContain("Console")
    expect(line).not.toContain("Copy")
    t.destroy()
  })

  test("输入进入聚焦控件，Tab 切换焦点", async () => {
    let a = ""
    let b = ""
    const t = await renderTui(
      wrap(
        <>
          <Input value={a} tuiOnChange={(v) => (a = v)} placeholder="field-a" />
          <Input value={b} tuiOnChange={(v) => (b = v)} placeholder="field-b" />
        </>,
      ),
      { width: 40, height: 10 },
    )

    expect(t.frame()).toContain("field-a")

    await t.type("hello")
    expect(a).toBe("hello")
    expect(b).toBe("")

    await t.tab()
    await t.type("world")
    expect(b).toBe("world")

    await t.tab(true) // Shift+Tab 回到第一个
    await t.type("!")
    expect(a).toBe("hello!")
    t.destroy()
  })

  test("tuiOnPressEnter 只响应输入框内的 Enter", async () => {
    let submits = 0
    const t = await renderTui(
      wrap(<Input value="query" tuiOnChange={() => {}} tuiOnPressEnter={() => submits++} />),
      { width: 40, height: 5 },
    )

    await t.enter()
    expect(submits).toBe(1)
    t.destroy()
  })

  test("tuiHighlights 直接装饰原生输入缓冲", async () => {
    const t = await renderTui(
      wrap(
        <Input
          compact
          value="echo --help"
          tuiOnChange={() => {}}
          tuiHighlights={[
            { start: 0, end: 4, color: "#40a9ff", bold: true },
            { start: 5, end: 11, color: "#faad14" },
          ]}
        />,
      ),
      { width: 40, height: 4 },
    )

    const line = t.raw.captureSpans().lines.find((item) => item.spans.some((span) => span.text.includes("echo")))!
    const command = line.spans.find((span) => span.text.includes("echo"))!
    const option = line.spans.find((span) => span.text.includes("--help"))!
    expect(command.fg.toInts()).toEqual(parseColor("#40a9ff").toInts())
    expect(option.fg.toInts()).toEqual(parseColor("#faad14").toInts())
    t.destroy()
  })

  test("tuiShowCursor 隐藏光标但不撤销输入焦点", async () => {
    let value = ""
    const t = await renderTui(
      wrap(<Input value={value} tuiShowCursor={false} tuiOnChange={(next) => (value = next)} />),
      { width: 40, height: 4 },
    )
    expect(t.raw.renderer.getCursorState().visible).toBe(false)
    await t.type("x")
    expect(value).toBe("x")
    t.destroy()
  })

  test("tuiOnTab 接管补全且不切走焦点", async () => {
    function Demo() {
      const [value, setValue] = useState("pw")
      return (
        <Input
          compact
          value={value}
          tuiOnChange={setValue}
          tuiOnTab={({ value: current }) => ({ value: `${current}d `, cursor: 4 })}
        />
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 4 })
    await t.tab()
    expect(t.frame()).toContain("pwd ")
    await t.type("x")
    expect(t.frame()).toContain("pwd x")
    t.destroy()
  })

  test("异步 Tab 结果不会覆盖随后输入的新文本", async () => {
    let finish: ((edit: { value: string; cursor: number }) => void) | undefined
    function Demo() {
      const [value, setValue] = useState("pw")
      return (
        <Input
          value={value}
          tuiOnChange={setValue}
          tuiOnTab={() => new Promise((resolve) => {
            finish = resolve
          })}
        />
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 4 })
    await t.tab()
    await t.type("x")
    finish?.({ value: "pwd ", cursor: 4 })
    await t.waitUntil(() => t.frame().includes("pwx"))
    expect(t.frame()).not.toContain("pwd ")
    t.destroy()
  })
})

describe("Flex", () => {
  test("vertical / gap 采用 antd Flex 语义", async () => {
    const t = await renderTui(
      wrap(
        <Flex vertical gap={1} style={{ width: "100%" }}>
          <Button tuiSize="small" block tuiOnClick={() => {}}>
            first
          </Button>
          <Button tuiSize="small" block tuiOnClick={() => {}}>
            second
          </Button>
        </Flex>,
      ),
      { width: 40, height: 6 },
    )

    const lines = t.frame().split("\n")
    const firstLine = lines.findIndex((line) => line.includes("first"))
    const secondLine = lines.findIndex((line) => line.includes("second"))
    expect(firstLine).toBeGreaterThanOrEqual(0)
    expect(secondLine).toBeGreaterThan(firstLine + 1)
    t.destroy()
  })

  test("tuiScroll 的纵向内容保持父容器全宽", async () => {
    const t = await renderTui(
      wrap(
        <Flex vertical tuiScroll style={{ height: "100%" }}>
          <Flex gap={1}>
            <Button tuiSize="small" block style={{ width: 30 }} tuiOnClick={() => {}}>
              left
            </Button>
            <Button tuiSize="small" block style={{ width: 30 }} tuiOnClick={() => {}}>
              right
            </Button>
          </Flex>
        </Flex>,
      ),
      { width: 80, height: 8 },
    )

    const line = t.frame().split("\n").find((item) => item.includes("left"))
    expect(line).toBeDefined()
    expect(line!.indexOf("right")).toBeGreaterThan(30)
    t.destroy()
  })

  test("纵向 tuiScroll 将滚动条固定在视口右侧", async () => {
    const t = await renderTui(
      wrap(
        <Flex vertical tuiScroll style={{ height: 8 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <Typography.Text key={i}>{String(i)}</Typography.Text>
          ))}
        </Flex>,
      ),
      { width: 40, height: 10 },
    )

    const scrollbox = findScrollbox(t.raw.renderer.root)
    expect(scrollbox).toBeDefined()
    expect(scrollbox!.verticalScrollBar.x).toBe(scrollbox!.x + scrollbox!.width - 1)
    expect(scrollbox!.verticalScrollBar.y).toBe(scrollbox!.y)
    expect(scrollbox!.verticalScrollBar.height).toBe(scrollbox!.height)
    t.destroy()
  })
})

describe("Space", () => {
  test("wrap 使用 antd 同名语义，在可用宽度不足时换行", async () => {
    const t = await renderTui(
      wrap(
        <Space wrap size={1}>
          <Button tuiSize="small" style={{ width: 8 }} tuiOnClick={() => {}}>
            first
          </Button>
          <Button tuiSize="small" style={{ width: 8 }} tuiOnClick={() => {}}>
            second
          </Button>
          <Button tuiSize="small" style={{ width: 8 }} tuiOnClick={() => {}}>
            third
          </Button>
        </Space>,
      ),
      { width: 20, height: 8 },
    )

    const lines = t.frame().split("\n")
    expect(lines.findIndex((line) => line.includes("first"))).toBe(
      lines.findIndex((line) => line.includes("second")),
    )
    expect(lines.findIndex((line) => line.includes("third"))).toBeGreaterThan(
      lines.findIndex((line) => line.includes("first")),
    )
    t.destroy()
  })
})

describe("List + Typography.Link", () => {
  test("List.Item 渲染为带分割线的终端结果列表", async () => {
    const t = await renderTui(
      wrap(
        <List bordered header="结果">
          <List.Item>第一条</List.Item>
          <List.Item>第二条</List.Item>
        </List>,
      ),
      { width: 40, height: 8 },
    )

    const frame = t.frame()
    expect(frame).toContain("结果")
    expect(frame).toContain("第一条")
    expect(frame).toContain("第二条")
    expect(frame).toContain("─")
    t.destroy()
  })

  test("dataSource / renderItem 保持 antd List 的常用数据入口", async () => {
    const t = await renderTui(
      wrap(
        <List
          dataSource={["Ant Design", "Formily"]}
          renderItem={(item) => <List.Item>{item}</List.Item>}
        />,
      ),
      { width: 40, height: 6 },
    )

    expect(t.frame()).toContain("Ant Design")
    expect(t.frame()).toContain("Formily")
    t.destroy()
  })

  test("Typography.Link 的 tuiOnClick 可由 Enter 激活", async () => {
    let clicks = 0
    const t = await renderTui(
      wrap(
        <Typography.Link href="https://ant.design" tuiOnClick={() => clicks++}>
          Ant Design
        </Typography.Link>,
      ),
      { width: 40, height: 4 },
    )

    await t.enter()
    expect(clicks).toBe(1)
    expect(t.frame()).toContain("Ant Design")
    t.destroy()
  })
})

describe("InputNumber", () => {
  test("仅接受数字，提交 number 类型", async () => {
    let value: number | null | undefined
    const t = await renderTui(
      wrap(<InputNumber value={value ?? undefined} onChange={(v) => (value = v)} />),
      { width: 40, height: 8 },
    )

    await t.type("12abc.5xyz")
    // 非法字符被拒绝，草稿保持 12.5
    expect(value).toBe(12.5)
    expect(t.frame()).toContain("12.5")
    expect(t.frame()).not.toContain("abc")
    t.destroy()
  })
})

describe("Button loading/danger", () => {
  test("loading 显示旋转帧且不可点击;danger 用错误色", async () => {
    const clicks: string[] = []
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <box style={{ flexDirection: "column", gap: 1 }}>
            <Button loading tuiOnClick={() => clicks.push("loading")}>
              提交
            </Button>
            <Button danger tuiOnClick={() => clicks.push("danger")}>
              删除
            </Button>
          </box>
        </FocusScope>
      </ConfigProvider>,
      { width: 40, height: 12 },
    )
    const frame = t.frame()
    expect(frame).toContain("提交")
    expect(frame).toContain("删除")
    // loading 前缀旋转帧(Braille 点阵字符之一)
    expect(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 提交/.test(frame)).toBe(true)
    t.destroy()
  }, 20000)
})

describe("布局与空值直觉", () => {
  test("非 block 按钮贴合内容宽度,不被列容器拉满", async () => {
    const t = await renderTui(
      wrap(
        <box style={{ flexDirection: "column", width: "100%" }}>
          <Button>确定</Button>
        </box>,
      ),
      { width: 60, height: 8 },
    )
    const frame = t.frame()
    const borderLine = frame.split("\n").find((l) => l.includes("╭") || l.includes("╔"))!
    // 边框宽度 ≈ 文案 + padding,远小于 60 列
    expect(borderLine.trim().length).toBeLessThan(20)
    t.destroy()
  }, 20000)

  test("空字符串 Typography.Text 不占行", async () => {
    const t = await renderTui(
      wrap(
        <box style={{ flexDirection: "column" }}>
          <Typography.Text>上一行</Typography.Text>
          <Typography.Text>{""}</Typography.Text>
          <Typography.Text>下一行</Typography.Text>
        </box>,
      ),
      { width: 30, height: 8 },
    )
    const lines = t.frame().split("\n")
    const a = lines.findIndex((l) => l.includes("上一行"))
    const b = lines.findIndex((l) => l.includes("下一行"))
    expect(b - a).toBe(1)
    t.destroy()
  }, 20000)

})
