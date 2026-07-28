import { describe, expect, test } from "bun:test"
import { renderTui, KeyCodes } from "@antd-tui/test-utils"
import { Button, Col, ConfigProvider, FocusScope, Input, Row } from "../src"

/**
 * antd 语义 Grid（Row gutter / Col flex·span）+ 方向键空间导航 + Button 热键。
 * 自适应由标准语义表达：Col flex: 1 均分行宽。
 */

function renderGrid(log: string[]) {
  return renderTui(
    <ConfigProvider>
      <FocusScope>
        <box style={{ flexDirection: "column", width: "100%" }}>
          <Row gutter={1}>
            <Col flex={1}>
              <Button tuiSize="small" block onClick={() => log.push("A")}>
                A
              </Button>
            </Col>
            <Col flex={1}>
              <Button tuiSize="small" block onClick={() => log.push("B")}>
                B
              </Button>
            </Col>
          </Row>
          <Row gutter={1}>
            <Col flex={1}>
              <Button tuiSize="small" block onClick={() => log.push("C")}>
                C
              </Button>
            </Col>
            <Col flex={1}>
              <Button tuiSize="small" block onClick={() => log.push("D")}>
                D
              </Button>
            </Col>
          </Row>
        </box>
      </FocusScope>
    </ConfigProvider>,
    { width: 40, height: 12 },
  )
}

describe("Row/Col 栅格", () => {
  test("Col flex 均分：同一 Row 的按钮同行且各占半区", async () => {
    const t = await renderGrid([])
    const lines = t.frame().split("\n")
    const lineAB = lines.find((l) => l.includes("A"))
    expect(lineAB).toBeDefined()
    expect(lineAB!).toContain("B")
    const lineCD = lines.find((l) => l.includes("C"))
    expect(lineCD!).toContain("D")
    // 两行分开
    expect(lineAB!).not.toContain("C")
    // flex: 1 均分：A 在左半区，B 在右半区
    expect(lineAB!.indexOf("A")).toBeLessThan(20)
    expect(lineAB!.indexOf("B")).toBeGreaterThanOrEqual(20)
    t.destroy()
  })

  test("Col span 定宽：span 12 占半行", async () => {
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Row>
            <Col span={12}>
              <Button tuiSize="small" block onClick={() => {}}>
                L
              </Button>
            </Col>
            <Col span={12}>
              <Button tuiSize="small" block onClick={() => {}}>
                R
              </Button>
            </Col>
          </Row>
        </FocusScope>
      </ConfigProvider>,
      { width: 40, height: 6 },
    )
    const line = t
      .frame()
      .split("\n")
      .find((l) => l.includes("L"))
    expect(line!).toContain("R")
    expect(line!.indexOf("L")).toBeLessThan(20)
    expect(line!.indexOf("R")).toBeGreaterThanOrEqual(20)
    t.destroy()
  })
})

describe("方向键空间导航", () => {
  test("↑↓←→ 在 2×2 网格中移动焦点，Enter 激活", async () => {
    const log: string[] = []
    const t = await renderGrid(log)

    // 初始焦点 A
    await t.press(KeyCodes.ARROW_RIGHT)
    await t.enter()
    expect(log).toEqual(["B"])

    await t.press(KeyCodes.ARROW_DOWN)
    await t.enter()
    expect(log).toEqual(["B", "D"])

    await t.press(KeyCodes.ARROW_LEFT)
    await t.enter()
    expect(log).toEqual(["B", "D", "C"])

    await t.press(KeyCodes.ARROW_UP)
    await t.enter()
    expect(log).toEqual(["B", "D", "C", "A"])
    t.destroy()
  })
})

describe("Button 热键", () => {
  test("热键直接触发 onClick，无需焦点", async () => {
    const log: string[] = []
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <box style={{ flexDirection: "column" }}>
            <Button onClick={() => log.push("first")}>first</Button>
            <Button tuiHotkey="x" onClick={() => log.push("hot")}>
              hot
            </Button>
          </box>
        </FocusScope>
      </ConfigProvider>,
      { width: 40, height: 12 },
    )

    // 焦点在 first，按 x 仍触发 hot 按钮
    await t.type("x")
    expect(log).toEqual(["hot"])
    t.destroy()
  })

  test("输入框聚焦时热键失效，按键进入输入框", async () => {
    const log: string[] = []
    let value = ""
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <box style={{ flexDirection: "column" }}>
            <Input value={value} tuiOnChange={(v: string) => (value = v)} />
            <Button tuiHotkey="x" onClick={() => log.push("hot")}>
              hot
            </Button>
          </box>
        </FocusScope>
      </ConfigProvider>,
      { width: 40, height: 12 },
    )

    // 焦点在 Input（首个注册），x 应写入输入框而非触发热键
    await t.type("x")
    expect(log).toEqual([])
    expect(value).toBe("x")
    t.destroy()
  })

  test("单字符热键匹配可见字符：符号键经 sequence 触发", async () => {
    const log: string[] = []
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <box style={{ flexDirection: "column" }}>
            <Button onClick={() => log.push("first")}>first</Button>
            <Button tuiHotkey="+" onClick={() => log.push("plus")}>
              plus
            </Button>
          </box>
        </FocusScope>
      </ConfigProvider>,
      { width: 40, height: 12 },
    )
    await t.type("+")
    expect(log).toEqual(["plus"])
    t.destroy()
  })

  test("多字符热键只匹配命名键：backspace 键触发，字符 b 不触发", async () => {
    const log: string[] = []
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <box style={{ flexDirection: "column" }}>
            <Button onClick={() => log.push("first")}>first</Button>
            <Button tuiHotkey="backspace" onClick={() => log.push("del")}>
              del
            </Button>
          </box>
        </FocusScope>
      </ConfigProvider>,
      { width: 40, height: 12 },
    )
    await t.type("b")
    expect(log).toEqual([])
    await t.press(KeyCodes.BACKSPACE)
    expect(log).toEqual(["del"])
    t.destroy()
  })
})
