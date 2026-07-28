import { describe, expect, test } from "bun:test"
import { createForm } from "@formily/core"
import type { Form } from "@formily/core"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { FormProvider, SchemaField } from "../src/index"

/**
 * 验证「逻辑全在 schema」的前置能力：
 * void Button 的 x-component-props.onClick 用 {{ }} 表达式操作 $form，
 * 展示字段随 form.values 联动刷新。计算器示例整体依赖此机制。
 */

function renderSchema(form: Form<any>, schema: object) {
  return renderTui(
    <ConfigProvider>
      <FocusScope>
        <FormProvider form={form}>
          <SchemaField schema={schema as never} />
        </FormProvider>
      </FocusScope>
    </ConfigProvider>,
    { width: 50, height: 16 },
  )
}

describe("x-component-props 表达式", () => {
  test("void Button onClick 表达式可写 form.values 并联动展示", async () => {
    const form = createForm({ initialValues: { display: "0" } })
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        display: { type: "string", "x-component": "Typography.Text" },
        k7: {
          type: "void",
          "x-component": "Button",
          "x-component-props": {
            tuiOnClick:
              "{{ () => $form.setValuesIn('display', ($form.values.display === '0' ? '' : $form.values.display) + '7') }}",
          },
        },
      },
    })

    // 首个 focusable 即 Button，Enter 激活
    await t.enter()
    expect(form.values.display).toBe("7")
    await t.enter()
    expect(form.values.display).toBe("77")
    await t.waitUntil(() => t.frame().includes("77"))
    t.destroy()
  })

  test("block-body 箭头函数表达式（多语句 + Function 求值）", async () => {
    const form = createForm({ initialValues: { display: "6*7" } })
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        display: { type: "string", "x-component": "Typography.Text" },
        keq: {
          type: "void",
          "x-component": "Button",
          "x-component-props": {
            tuiOnClick:
              "{{ () => { const s = $form.values.display; try { $form.setValuesIn('display', String(Function('return (' + s + ')')())) } catch (e) { $form.setValuesIn('display', '错误') } } }}",
          },
        },
      },
    })

    await t.enter()
    expect(form.values.display).toBe("42")
    t.destroy()
  })
})
