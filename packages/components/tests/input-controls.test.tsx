import { describe, expect, test } from "bun:test"
import { useState, type ReactNode } from "react"
import { renderTui, KeyCodes } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope, Input, Slider } from "../src"

/**
 * 输入类控件：Input.TextArea（多行）与 Slider（←→ 调节）。
 */

function wrap(node: ReactNode) {
  return (
    <ConfigProvider>
      <FocusScope>{node}</FocusScope>
    </ConfigProvider>
  )
}

describe("Input.TextArea", () => {
  test("多行编辑：输入文本上屏并上报内容", async () => {
    const seen: string[] = []
    const t = await renderTui(
      wrap(<Input.TextArea rows={3} tuiOnChange={(v) => seen.push(v)} placeholder="备注" />),
      { width: 40, height: 8 },
    )

    expect(t.frame()).toContain("备注")
    await t.type("hello")
    expect(t.frame()).toContain("hello")
    expect(seen.at(-1)).toBe("hello")
    t.destroy()
  })

  test("tuiDefaultValue 作为初值渲染", async () => {
    const t = await renderTui(wrap(<Input.TextArea rows={2} tuiDefaultValue="初始文本" />), {
      width: 40,
      height: 8,
    })
    expect(t.frame()).toContain("初始文本")
    t.destroy()
  })
})

describe("Input 鼠标聚焦", () => {
  test("点击第二个输入框后按键归它", async () => {
    function Demo() {
      const [a, setA] = useState("")
      const [b, setB] = useState("")
      return (
        <>
          <Input value={a} tuiOnChange={setA} placeholder="甲" />
          <Input value={b} tuiOnChange={setB} placeholder="乙" />
        </>
      )
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 10 })

    // 初始焦点在第一个输入框；点击第二个（其边框盒从 y=3 起，点内容行 y=4）
    await t.raw.mockMouse.click(3, 4)
    await t.settle()
    await t.type("hi")
    const frame = t.frame()
    // 文本落在第二个输入框，第一个仍是占位符
    expect(frame).toContain("甲")
    expect(frame).toContain("hi")
    t.destroy()
  })
})

describe("Slider", () => {
  test("←→ 按 step 调节，Home/End 到端点", async () => {
    function Demo() {
      const [value, setValue] = useState(50)
      return <Slider min={0} max={100} step={10} value={value} onChange={setValue} />
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 6 })

    expect(t.frame()).toContain("50")
    await t.press(KeyCodes.ARROW_RIGHT)
    expect(t.frame()).toContain("60")

    await t.press(KeyCodes.ARROW_LEFT)
    await t.press(KeyCodes.ARROW_LEFT)
    expect(t.frame()).toContain("40")

    await t.press(KeyCodes.END)
    expect(t.frame()).toContain("100")
    await t.press(KeyCodes.HOME)
    // 端点后停在 min，且不越界
    expect(t.frame()).toContain("0")
    await t.press(KeyCodes.ARROW_LEFT)
    expect(t.frame()).toContain("0")
    t.destroy()
  })

  test("disabled 时不响应按键", async () => {
    let called = false
    const t = await renderTui(
      wrap(<Slider disabled value={30} onChange={() => (called = true)} />),
      { width: 40, height: 6 },
    )
    await t.press(KeyCodes.ARROW_RIGHT)
    expect(called).toBe(false)
    t.destroy()
  })

  test("小数 step 不产生浮点误差", async () => {
    function Demo() {
      const [value, setValue] = useState(0)
      return <Slider min={0} max={1} step={0.1} value={value} onChange={setValue} />
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 6 })
    await t.press(KeyCodes.ARROW_RIGHT)
    await t.press(KeyCodes.ARROW_RIGHT)
    await t.press(KeyCodes.ARROW_RIGHT)
    // 0.1 + 0.1 + 0.1 应显示 0.3 而非 0.30000000000000004
    expect(t.frame()).toContain("0.3")
    t.destroy()
  })

  test("鼠标点击/拖动轨道按位置取值", async () => {
    function Demo() {
      const [value, setValue] = useState(0)
      return <Slider min={0} max={100} step={10} value={value} onChange={setValue} />
    }
    const t = await renderTui(wrap(<Demo />), { width: 40, height: 6 })

    // 数值区按内容宽预留：点击行末（超出轨道会 clamp 到末端）→ 100
    await t.raw.mockMouse.click(39, 0)
    await t.settle()
    expect(t.frame()).toContain("100")

    // 值为 100 时轨道宽 = 40 - 4 = 36，拖到 x=17：17/35 ≈ 48.6，按 step 10 对齐 → 50
    await t.raw.mockMouse.drag(39, 0, 17, 0)
    await t.settle()
    expect(t.frame()).toContain("50")
    t.destroy()
  })

  test("disabled 时鼠标点击不生效", async () => {
    let called = false
    const t = await renderTui(
      wrap(<Slider disabled value={30} onChange={() => (called = true)} />),
      { width: 40, height: 6 },
    )
    await t.raw.mockMouse.click(39, 0)
    await t.settle()
    expect(called).toBe(false)
    t.destroy()
  })
})
