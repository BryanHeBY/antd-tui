import { describe, expect, test } from "bun:test"
import { renderTui } from "@antd-tui/test-utils"
import { Button, ConfigProvider, FocusScope, message } from "../src"

/**
 * message：useMessage hook 形态（对齐 antd v5），holder 渲染进组件树，
 * api 触发后提示条上屏，duration 到期自动消失，duration=0 常驻，destroy 全清。
 */

function Demo({ onApi }: { onApi: (api: ReturnType<typeof message.useMessage>[0]) => void }) {
  const [api, holder] = message.useMessage()
  return (
    <ConfigProvider>
      <FocusScope>
        <box style={{ flexDirection: "column" }}>
          {holder}
          <Button onClick={() => onApi(api)}>触发</Button>
        </box>
      </FocusScope>
    </ConfigProvider>
  )
}

describe("message", () => {
  test("各类型提示上屏并带对应图标", async () => {
    const t = await renderTui(
      <Demo
        onApi={(api) => {
          api.success("保存成功")
          api.error("保存失败")
          api.info("提示信息")
          api.warning("注意事项")
          api.loading("加载中")
        }}
      />,
      { width: 60, height: 16 },
    )
    await t.enter()
    const frame = t.frame()
    expect(frame).toContain("✓ 保存成功")
    expect(frame).toContain("✗ 保存失败")
    expect(frame).toContain("i 提示信息")
    expect(frame).toContain("! 注意事项")
    expect(frame).toContain("◌ 加载中")
    t.destroy()
  })

  test("duration 到期自动消失并触发 onClose", async () => {
    let closed = 0
    const t = await renderTui(
      <Demo
        onApi={(api) => {
          api.success({ content: "短暂提示", duration: 0.05, onClose: () => closed++ })
        }}
      />,
      { width: 60, height: 12 },
    )
    await t.enter()
    expect(t.frame()).toContain("短暂提示")
    await t.waitUntil(() => !t.frame().includes("短暂提示"))
    expect(closed).toBe(1)
    t.destroy()
  })

  test("duration=0 不自动关闭，destroy 清空全部", async () => {
    let fired: ReturnType<typeof message.useMessage>[0] | null = null
    const t = await renderTui(
      <Demo
        onApi={(api) => {
          if (!fired) {
            fired = api
            api.info({ content: "常驻提示", duration: 0 })
          } else {
            api.destroy()
          }
        }}
      />,
      { width: 60, height: 12 },
    )
    await t.enter()
    expect(t.frame()).toContain("常驻提示")

    // 等待一段时间确认不会自动消失
    await new Promise((r) => setTimeout(r, 100))
    expect(t.frame()).toContain("常驻提示")

    // 再次触发调用 destroy
    await t.enter()
    await t.waitUntil(() => !t.frame().includes("常驻提示"))
    t.destroy()
  })
})
