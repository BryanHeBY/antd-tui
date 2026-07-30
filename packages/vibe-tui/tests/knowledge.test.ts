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

  test("引导骨架优先的增量搭建,并在复杂页面前取参考实现", () => {
    // 首个 eval 必须小:人类的等待时长 = 首个 eval 的生成时长
    expect(BOOT_PROMPT).toContain("骨架优先")
    expect(BOOT_PROMPT).toContain("10 行以内")
    expect(LIVE_GUIDE).toContain("骨架优先")
    // example 是硬性前置(同 skill 语义),不是"按需"
    expect(BOOT_PROMPT).toContain("vibetui_example")
    expect(BOOT_PROMPT).toContain("必经步骤")
    expect(LIVE_GUIDE.slice(0, 700)).toContain("vibetui_example()")
    expect(LIVE_GUIDE).toContain("硬性前置要求")
    // 会话恢复:引导会重复注入,已读过就别重复取、也别重建画布
    expect(BOOT_PROMPT).toContain("会话恢复")
    expect(LIVE_GUIDE).toContain("session 恢复")
    // 反向约束:别中途频繁截帧
    expect(LIVE_GUIDE).toContain("搭完整页后验收一次")
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
