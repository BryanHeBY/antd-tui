import { describe, expect, test } from "bun:test"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider } from "../src/theme"
import { FocusScope } from "../src/focus"
import { Button } from "../src/components/Button"
import { Input } from "../src/components/Input"
import { InputNumber } from "../src/components/InputNumber"
import { Flex } from "../src/components/Flex"
import { List } from "../src/components/List"
import { Typography } from "../src/components/Typography"

function wrap(children: React.ReactNode) {
  return (
    <ConfigProvider>
      <FocusScope>{children}</FocusScope>
    </ConfigProvider>
  )
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
