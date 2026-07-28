import { describe, expect, test } from "bun:test"
import { useState } from "react"
import { renderTui, KeyCodes } from "@antd-tui/test-utils"
import { Button, Checkbox, ConfigProvider, FocusScope, Modal } from "../src"

/**
 * Modal：浮层渲染、确认/取消回调、Esc 关闭，以及焦点圈闭
 * （打开时下层作用域的按键与热键必须静默）。
 */

describe("Modal", () => {
  test("open=false 不渲染，open=true 渲染标题与按钮", async () => {
    const closed = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Modal open={false} title="确认删除">
            <text>内容</text>
          </Modal>
        </FocusScope>
      </ConfigProvider>,
      { width: 60, height: 16 },
    )
    expect(closed.frame()).not.toContain("确认删除")
    closed.destroy()

    const opened = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Modal open title="确认删除">
            <text>此操作不可撤销</text>
          </Modal>
        </FocusScope>
      </ConfigProvider>,
      { width: 60, height: 16 },
    )
    const frame = opened.frame()
    expect(frame).toContain("确认删除")
    expect(frame).toContain("此操作不可撤销")
    expect(frame).toContain("确定")
    expect(frame).toContain("取消")
    opened.destroy()
  })

  test("Enter 激活确定按钮，方向键可切到取消", async () => {
    const events: string[] = []
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Modal open title="标题" onOk={() => events.push("ok")} onCancel={() => events.push("cancel")}>
            <text>正文</text>
          </Modal>
        </FocusScope>
      </ConfigProvider>,
      { width: 60, height: 16 },
    )

    // 浮层内首个 focusable 是确定按钮
    await t.enter()
    expect(events).toEqual(["ok"])

    await t.press(KeyCodes.ARROW_RIGHT)
    await t.enter()
    expect(events).toEqual(["ok", "cancel"])
    t.destroy()
  })

  test("Esc 触发 onCancel，keyboard=false 时不响应", async () => {
    let cancelled = 0
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Modal open title="标题" onCancel={() => cancelled++}>
            <text>正文</text>
          </Modal>
        </FocusScope>
      </ConfigProvider>,
      { width: 60, height: 16 },
    )
    await t.escape()
    expect(cancelled).toBe(1)
    t.destroy()

    const noKeyboard = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Modal open keyboard={false} title="标题" onCancel={() => cancelled++}>
            <text>正文</text>
          </Modal>
        </FocusScope>
      </ConfigProvider>,
      { width: 60, height: 16 },
    )
    await noKeyboard.escape()
    expect(cancelled).toBe(1)
    noKeyboard.destroy()
  })

  test("footer=null 不渲染按钮区", async () => {
    const t = await renderTui(
      <ConfigProvider>
        <FocusScope>
          <Modal open title="无按钮" footer={null}>
            <text>正文</text>
          </Modal>
        </FocusScope>
      </ConfigProvider>,
      { width: 60, height: 16 },
    )
    expect(t.frame()).toContain("无按钮")
    expect(t.frame()).not.toContain("确定")
    t.destroy()
  })
})

describe("Modal 焦点圈闭", () => {
  test("浮层打开时下层按钮的 Enter 与热键均静默", async () => {
    const events: string[] = []
    function Demo() {
      const [open, setOpen] = useState(false)
      return (
        <ConfigProvider>
          <FocusScope>
            <box style={{ flexDirection: "column" }}>
              <Button tuiHotkey="d" onClick={() => events.push("outer-hotkey")}>
                下层按钮
              </Button>
              <Button onClick={() => setOpen(true)}>打开浮层</Button>
              <Modal open={open} title="浮层" onOk={() => events.push("ok")} onCancel={() => setOpen(false)}>
                <text>浮层正文</text>
              </Modal>
            </box>
          </FocusScope>
        </ConfigProvider>
      )
    }
    const t = await renderTui(<Demo />, { width: 60, height: 20 })

    // 下层热键先验证可用
    await t.type("d")
    expect(events).toEqual(["outer-hotkey"])

    // 打开浮层：焦点在「打开浮层」按钮（第二个）
    await t.press(KeyCodes.ARROW_DOWN)
    await t.enter()
    await t.waitUntil(() => t.frame().includes("浮层正文"))

    // 下层热键静默
    await t.type("d")
    expect(events).toEqual(["outer-hotkey"])

    // 按键归浮层：Enter 触发浮层的确定
    await t.enter()
    expect(events).toEqual(["outer-hotkey", "ok"])

    // 关闭后下层恢复响应
    await t.escape()
    await t.waitUntil(() => !t.frame().includes("浮层正文"))
    await t.type("d")
    expect(events).toEqual(["outer-hotkey", "ok", "outer-hotkey"])
    t.destroy()
  })

  test("浮层打开时下层 Checkbox 的空格切换静默", async () => {
    function Demo() {
      const [checked, setChecked] = useState(false)
      const [open, setOpen] = useState(true)
      return (
        <ConfigProvider>
          <FocusScope>
            <box style={{ flexDirection: "column" }}>
              <Checkbox checked={checked} tuiOnChange={setChecked}>
                下层选项
              </Checkbox>
              <Modal open={open} title="浮层" footer={null} onCancel={() => setOpen(false)}>
                <text>浮层正文</text>
              </Modal>
            </box>
          </FocusScope>
        </ConfigProvider>
      )
    }
    const t = await renderTui(<Demo />, { width: 60, height: 20 })

    await t.type(" ")
    expect(t.frame()).toContain("[ ] 下层选项")

    // 关闭浮层后恢复
    await t.escape()
    await t.waitUntil(() => !t.frame().includes("浮层正文"))
    await t.type(" ")
    expect(t.frame()).toContain("[x] 下层选项")
    t.destroy()
  })
})
