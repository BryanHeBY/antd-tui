import { describe, expect, test } from "bun:test"
import { componentPropsWhitelist, componentWhitelist } from "@antd-tui/components"
import { inputBindings, liveComponents, rawTextContentComponents } from "../src/registry"

/**
 * 注册表一致性守卫:组件表面分散在多处(componentWhitelist / propsWhitelist /
 * live registry),新增组件漏改任意一处都会产生"白名单放行但渲染缺失"
 * 或反向的漂移。此处集中断言,漂移在 CI 立即暴露。
 */
describe("live 注册表一致性", () => {
  test("componentWhitelist ↔ liveComponents 双向一致", () => {
    const live = Object.keys(liveComponents).sort()
    expect(live).toEqual([...componentWhitelist].sort())
  })

  test("每个白名单组件都有 props 白名单", () => {
    for (const name of componentWhitelist) {
      expect(componentPropsWhitelist[name], `缺 props 白名单:${name}`).toBeDefined()
    }
    expect(Object.keys(componentPropsWhitelist).sort()).toEqual([...componentWhitelist].sort())
  })

  test("inputBindings / rawTextContentComponents ⊆ componentWhitelist", () => {
    const all = new Set(componentWhitelist)
    for (const name of Object.keys(inputBindings)) {
      expect(all.has(name), `inputBindings 含未白名单组件:${name}`).toBe(true)
    }
    for (const name of rawTextContentComponents) {
      expect(all.has(name), `rawTextContentComponents 含未白名单组件:${name}`).toBe(true)
    }
  })
})
