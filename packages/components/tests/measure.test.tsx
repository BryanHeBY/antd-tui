import { describe, expect, test } from "bun:test"
import { ConfigProvider, useMeasuredWidth } from "../src/index"
import { renderTui } from "@antd-tui/test-utils"

function WidthProbe() {
  const { boxRef, width } = useMeasuredWidth()
  return <box ref={boxRef} style={{ width: 4, height: 1 }}><text>{String(width ?? 0)}</text></box>
}

describe("useMeasuredWidth", () => {
  test("多个测量节点共用一个 renderer resize 监听器", async () => {
    const t = await renderTui(
      <ConfigProvider>
        {Array.from({ length: 16 }, (_, index) => <WidthProbe key={index} />)}
      </ConfigProvider>,
      { width: 80, height: 20 },
    )
    await t.waitUntil(() => t.frame().includes("4"), 2000)
    expect(t.raw.renderer.listenerCount("resize")).toBe(1)
    t.destroy()
  })
})
