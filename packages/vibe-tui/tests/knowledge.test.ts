import { describe, expect, test } from "bun:test"
import { componentPropsWhitelist, componentWhitelist } from "@antd-tui/components"
import { BOOT_PROMPT, EXAMPLE_REFERENCE, LIVE_GUIDE } from "../src/knowledge"

/**
 * guide 内容守卫:速查表与白名单同源生成,任何白名单组件及其 props
 * 必须出现在 vibetui_guide 返回内容里——agent 的可查阅面不落后于校验面。
 */
describe("知识注入", () => {
  test("BOOT_PROMPT 引导先读 guide 并说明回流通道", () => {
    expect(BOOT_PROMPT).toContain("vibetui_guide")
    expect(BOOT_PROMPT).toContain("[page]")
    expect(BOOT_PROMPT).toContain("$agent.send")
  })

  test("LIVE_GUIDE 含全部白名单组件及其 props", () => {
    for (const name of componentWhitelist) {
      expect(LIVE_GUIDE).toContain(`- ${name}`)
      for (const prop of componentPropsWhitelist[name] ?? []) {
        expect(LIVE_GUIDE.includes(prop), `guide 缺 ${name}.${prop}`).toBe(true)
      }
    }
  })

  test("EXAMPLE_REFERENCE 内联 dashboard 源码与适配说明", () => {
    // 源码全文经 Bun 文本导入内联:关键片段必在
    expect(EXAMPLE_REFERENCE).toContain("buildDashboard")
    expect(EXAMPLE_REFERENCE).toContain("$ui.clear()")
    expect(EXAMPLE_REFERENCE).toContain("tuiOnPressEnter")
    // 适配说明:actions → $agent.send
    expect(EXAMPLE_REFERENCE).toContain("$agent.send")
    // guide 与 BOOT_PROMPT 指路
    expect(LIVE_GUIDE).toContain("vibetui_example")
    expect(BOOT_PROMPT).toContain("vibetui_example")
  })

  test("LIVE_GUIDE 覆盖节点 API 与复杂 props 形状", () => {
    for (const api of ["$ui.has", "$ui.watch", "$ui.escape", "toJSON", "moveTo"]) {
      expect(LIVE_GUIDE).toContain(api)
    }
    expect(LIVE_GUIDE).toContain("复杂 props 形状")
    expect(LIVE_GUIDE).toContain("dataIndex")
  })
})
