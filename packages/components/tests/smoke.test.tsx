import { describe, expect, test } from "bun:test"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider } from "../src/theme"
import { FocusScope } from "../src/focus"
import { Button } from "../src/components/Button"
import { Input } from "../src/components/Input"
import { InputNumber } from "../src/components/InputNumber"

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

    const line = t.frame().split("\\n").find((item) => item.includes("antd"))
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
