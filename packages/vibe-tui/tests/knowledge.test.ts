import { describe, expect, test } from "bun:test"
import { componentPropsWhitelist, componentWhitelist } from "@antd-tui/components"
import { LiveTree } from "@antd-tui/live"
import { createEvalRepl } from "../src/eval"
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
    expect(BOOT_PROMPT).toContain("vibetui_layout")
    expect(BOOT_PROMPT).toContain("vibetui_inspect")
    expect(BOOT_PROMPT).toContain("vibetui_reset")
  })

  test("LIVE_GUIDE 含全部白名单组件及其 props", () => {
    for (const name of componentWhitelist) {
      expect(LIVE_GUIDE).toContain(`- ${name}`)
      for (const prop of componentPropsWhitelist[name] ?? []) {
        expect(LIVE_GUIDE.includes(prop), `guide 缺 ${name}.${prop}`).toBe(true)
      }
    }
  })

  test("引导允许完整 JS,复杂页面按需取参考实现", () => {
    expect(BOOT_PROMPT).toContain("vibetui_example")
    expect(BOOT_PROMPT).toContain("一次写完整 JS")
    expect(LIVE_GUIDE).toContain("完整 JS 优先")
    expect(LIVE_GUIDE).toContain("复杂布局可调用")
    expect(BOOT_PROMPT).not.toContain("必经步骤")
    expect(LIVE_GUIDE).not.toContain("硬性前置要求")
    // 反向约束:别中途频繁截帧
    expect(LIVE_GUIDE).toContain("搭完整页后验收一次")
  })

  test("EXAMPLE_REFERENCE 是可直接执行的原生 REPL JavaScript", () => {
    expect(EXAMPLE_REFERENCE).toContain("$ui.clear()")
    expect(EXAMPLE_REFERENCE).toContain("$agent.send")
    expect(EXAMPLE_REFERENCE).not.toContain("import type")
    expect(EXAMPLE_REFERENCE).not.toContain("buildDashboard")

    const source = EXAMPLE_REFERENCE.match(/```js\n([\s\S]*?)\n```/)?.[1]
    expect(source).toBeDefined()
    const tree = new LiveTree()
    createEvalRepl({ $ui: tree.ui, $agent: { send: () => {} } }).evaluate(source!)
    expect(tree.ui.has("app")).toBe(true)
    expect(tree.ui.has("main")).toBe(true)

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

  test("LIVE_GUIDE 提供可复制的布局诊断、窄终端与文本槽位策略", () => {
    expect(LIVE_GUIDE).toContain("vibetui_layout()")
    expect(LIVE_GUIDE).toContain('vibetui_inspect({ id: "..." })')
    expect(LIVE_GUIDE).toContain('flex: "auto"')
    expect(LIVE_GUIDE).toContain("minWidth: 28")
    expect(LIVE_GUIDE).toContain("props.message")
    expect(LIVE_GUIDE).toContain("wrap: false")
    expect(LIVE_GUIDE).toContain("vibetui_reset()")
  })
})
