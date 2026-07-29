import { describe, expect, test } from "bun:test"
import { useState } from "react"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { PageView, type PageSchema } from "../src"

/**
 * PageView 热更稳定性（agent REPL 逐步搭页面的前提）：
 * schema 变更（同一挂载）不得重置表单值与 $state，新增节点即时上屏。
 */

const base: PageSchema = {
  version: "0.1",
  page: { title: "热更", mode: "interactive" },
  state: { count: 5 },
  form: {
    type: "object",
    properties: {
      name: {
        type: "string",
        title: "名称",
        "x-decorator": "FormItem",
        "x-component": "Input",
      },
      stat: {
        type: "void",
        "x-component": "Statistic",
        "x-component-props": { title: "计数", value: "{{ $state.count }}" },
      },
    },
  },
}

describe("PageView 热更", () => {
  test("schema 变更不重挂载：表单值与 $state 保留，新组件上屏，新 state 键补入", async () => {
    let setSchema: (s: PageSchema) => void = () => {}
    let scope: Record<string, unknown> = {}
    function Host() {
      const [schema, set] = useState<PageSchema>(base)
      setSchema = set
      return (
        <ConfigProvider>
          <FocusScope>
            <PageView
              schema={schema}
              onFinish={() => {}}
              onCancel={() => {}}
              onScopeReady={(s) => {
                scope = s
              }}
              hideHint
            />
          </FocusScope>
        </ConfigProvider>
      )
    }
    const t = await renderTui(<Host />, { width: 60, height: 18 })

    // 用户输入 + 运行时改 $state（模拟页面已被使用）
    await t.type("abc")
    expect(t.frame()).toContain("abc")
    ;(scope.$state as Record<string, unknown>).count = 9
    await t.settle()
    expect(t.frame()).toContain("9")

    // 热更：加按钮、state 段加新键
    const next = structuredClone(base)
    ;(next.form.properties as Record<string, unknown>).btn = {
      type: "void",
      "x-component": "Button",
      "x-content": "新按钮",
      "x-component-props": { tuiSize: "small" },
    }
    next.state = { count: 5, extra: 42 }
    setSchema(next)
    await t.settle()

    const frame = t.frame()
    expect(frame).toContain("新按钮")
    // 值与运行时状态保留：count 仍是 9（不被初值 5 重置），输入仍在
    expect(frame).toContain("abc")
    expect(frame).toContain("9")
    // 新声明的 state 键补入
    expect((scope.$state as Record<string, unknown>).extra).toBe(42)
    t.destroy()
  })
})
