import { describe, expect, test } from "bun:test"
import { componentWhitelist } from "@antd-tui/components"
import { schemaComponents } from "../src"

/**
 * schema 通路一致性守卫:componentWhitelist 放行的组件必须都能被
 * SchemaField 解析,否则校验通过的 schema 会渲染为空。
 */

/** formily 注册表以点号名展开(Typography.Text 等复合组件) */
function schemaComponentNames(): Set<string> {
  const names = new Set<string>()
  for (const [name, comp] of Object.entries(schemaComponents)) {
    names.add(name)
    for (const sub of Object.keys(comp as unknown as Record<string, unknown>)) {
      if (/^[A-Z]/.test(sub)) names.add(`${name}.${sub}`)
    }
  }
  return names
}

describe("schema 注册表一致性", () => {
  test("componentWhitelist ⊆ schemaComponents", () => {
    const names = schemaComponentNames()
    // TextArea 白名单名对应 Input.TextArea 复合入口
    const alias: Record<string, string> = { TextArea: "Input.TextArea" }
    for (const name of componentWhitelist) {
      const target = alias[name] ?? name
      expect(names.has(target), `schemaComponents 缺:${name}`).toBe(true)
    }
  })
})
