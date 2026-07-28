import { describe, expect, test } from "bun:test"
import { createForm } from "@formily/core"
import type { Form } from "@formily/core"
import { observable } from "@formily/reactive"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { FormProvider, SchemaField, compileScope } from "../src/index"

/**
 * scope 机制：页面 Schema 的 scope 段定义具名表达式函数，
 * 编译后注入 SchemaField 作用域，字段表达式按名调用。
 * 同时验证 x-content 文案通道（@formily/react 内建）畅通。
 */

function renderSchema(form: Form<any>, schema: object, scope?: Record<string, unknown>) {
  return renderTui(
    <ConfigProvider>
      <FocusScope>
        <FormProvider form={form}>
          <SchemaField schema={schema as never} scope={scope} />
        </FormProvider>
      </FocusScope>
    </ConfigProvider>,
    { width: 50, height: 16 },
  )
}

describe("compileScope", () => {
  test("scope 函数可写 form.values，字段表达式按名调用并联动展示", async () => {
    const form = createForm({ initialValues: { display: "0" } })
    const scope = compileScope(
      {
        pressDigit:
          "{{ (d) => $form.setValuesIn('display', ($form.values.display === '0' ? '' : $form.values.display) + d) }}",
      },
      { $form: form },
    )
    const t = await renderSchema(
      form,
      {
        type: "object",
        properties: {
          display: { type: "string", "x-component": "Typography.Text" },
          k7: {
            type: "void",
            "x-component": "Button",
            "x-component-props": {
              tuiOnClick: "{{ () => pressDigit('7') }}",
            },
          },
        },
      },
      scope,
    )

    await t.enter()
    expect(form.values.display).toBe("7")
    await t.enter()
    expect(form.values.display).toBe("77")
    await t.waitUntil(() => t.frame().includes("77"))
    t.destroy()
  })

  test("scope 函数可互相调用（不受定义顺序限制）", async () => {
    const form = createForm({ initialValues: { display: "" } })
    const scope = compileScope(
      {
        // append 定义在 pressA 之前引用，验证惰性查找
        pressA: "{{ () => append('A') }}",
        append: "{{ (ch) => $form.setValuesIn('display', $form.values.display + ch) }}",
      },
      { $form: form },
    )
    const t = await renderSchema(
      form,
      {
        type: "object",
        properties: {
          display: { type: "string", "x-component": "Typography.Text" },
          ka: {
            type: "void",
            "x-component": "Button",
            "x-component-props": { tuiOnClick: "{{ () => pressA() }}" },
          },
        },
      },
      scope,
    )

    await t.enter()
    await t.enter()
    expect(form.values.display).toBe("AA")
    t.destroy()
  })

  test("$memo 跨调用保持隐藏状态且不进 form.values", async () => {
    const form = createForm({ initialValues: { display: "0" } })
    const scope = compileScope(
      {
        press:
          "{{ () => { $memo.count = ($memo.count ?? 0) + 1; $form.setValuesIn('display', String($memo.count)) } }}",
      },
      { $form: form, $memo: {} },
    )
    const t = await renderSchema(
      form,
      {
        type: "object",
        properties: {
          display: { type: "string", "x-component": "Typography.Text" },
          k: {
            type: "void",
            "x-component": "Button",
            "x-component-props": { tuiOnClick: "{{ () => press() }}" },
          },
        },
      },
      scope,
    )

    await t.enter()
    await t.enter()
    await t.enter()
    expect(form.values.display).toBe("3")
    expect("count" in form.values).toBe(false)
    t.destroy()
  })

  test("$state（observable）：表达式读值响应 scope 函数写入，且不进 form.values", async () => {
    const form = createForm()
    const $state = observable({ cpu: 42 })
    const scope = compileScope(
      { addLoad: "{{ (d) => { $state.cpu += d } }}" },
      { $form: form, $state, $memo: {} },
    )
    const t = await renderSchema(
      form,
      {
        type: "object",
        properties: {
          bar: {
            type: "void",
            "x-component": "Progress",
            "x-component-props": { percent: "{{ $state.cpu }}" },
          },
          k: {
            type: "void",
            "x-component": "Button",
            "x-component-props": { tuiOnClick: "{{ () => addLoad(10) }}" },
          },
        },
      },
      scope,
    )

    expect(t.frame()).toContain("42%")
    await t.enter()
    await t.waitUntil(() => t.frame().includes("52%"))
    expect("cpu" in form.values).toBe(false)
    t.destroy()
  })
})

describe("x-content 文案通道", () => {
  test("void Button 用 x-content 提供文案，tuiOnClick 正常", async () => {
    const form = createForm({ initialValues: { display: "0" } })
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        display: { type: "string", "x-component": "Typography.Text" },
        k7: {
          type: "void",
          "x-component": "Button",
          "x-content": "柒",
          "x-component-props": {
            tuiOnClick: "{{ () => $form.setValuesIn('display', '7') }}",
          },
        },
      },
    })

    expect(t.frame()).toContain("柒")
    await t.enter()
    expect(form.values.display).toBe("7")
    t.destroy()
  })
})
