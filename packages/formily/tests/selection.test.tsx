import { describe, expect, test } from "bun:test"
import { createForm } from "@formily/core"
import type { Form } from "@formily/core"
import { renderTui, KeyCodes } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { FormProvider, SchemaField } from "../src/index"

/**
 * 选择类控件的 schema 绑定：enum → options、值回写 form.values。
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

describe("CheckboxGroup", () => {
  test("enum 渲染为多选项，选中值写回 form.values 数组", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        fruits: {
          type: "array",
          title: "水果",
          enum: [
            { label: "苹果", value: "apple" },
            { label: "香蕉", value: "banana" },
          ],
          "x-decorator": "FormItem",
          "x-component": "CheckboxGroup",
        },
      },
    })

    expect(t.frame()).toContain("苹果")
    await t.enter()
    await t.waitUntil(() => JSON.stringify(form.values.fruits) === JSON.stringify(["apple"]))

    await t.press(KeyCodes.ARROW_DOWN)
    await t.enter()
    await t.waitUntil(
      () => JSON.stringify(form.values.fruits) === JSON.stringify(["apple", "banana"]),
    )
    t.destroy()
  })
})

describe("RadioGroup", () => {
  test("enum 渲染为单选项，default 生效且选中写回", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        gender: {
          type: "string",
          title: "性别",
          default: "m",
          enum: [
            { label: "男", value: "m" },
            { label: "女", value: "f" },
          ],
          "x-decorator": "FormItem",
          "x-component": "RadioGroup",
        },
      },
    })

    expect(form.values.gender).toBe("m")
    expect(t.frame()).toContain("(o) 男")

    await t.press(KeyCodes.ARROW_DOWN)
    await t.enter()
    await t.waitUntil(() => form.values.gender === "f")
    expect(t.frame()).toContain("(o) 女")
    t.destroy()
  })
})

describe("Switch", () => {
  test("boolean 字段切换写回 form.values", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        enabled: {
          type: "boolean",
          title: "启用",
          "x-decorator": "FormItem",
          "x-component": "Switch",
          "x-component-props": { checkedChildren: "开", unCheckedChildren: "关" },
        },
      },
    })

    expect(t.frame()).toContain("关")
    await t.enter()
    await t.waitUntil(() => form.values.enabled === true)
    expect(t.frame()).toContain("开")
    t.destroy()
  })
})

describe("Checkbox", () => {
  test("单个 boolean 字段切换写回", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        agree: {
          type: "boolean",
          "x-decorator": "FormItem",
          "x-component": "Checkbox",
          "x-component-props": { children: "同意条款" },
        },
      },
    })

    expect(t.frame()).toContain("[ ] 同意条款")
    await t.enter()
    await t.waitUntil(() => form.values.agree === true)
    expect(t.frame()).toContain("[x] 同意条款")
    t.destroy()
  })
})

describe("TextArea", () => {
  test("多行输入写回 form.values", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        remark: {
          type: "string",
          title: "备注",
          "x-decorator": "FormItem",
          "x-component": "TextArea",
          "x-component-props": { rows: 3, placeholder: "请输入备注" },
        },
      },
    })

    expect(t.frame()).toContain("请输入备注")
    await t.type("hello")
    await t.waitUntil(() => form.values.remark === "hello")
    t.destroy()
  })
})

describe("Slider", () => {
  test("方向键调节写回 form.values", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        level: {
          type: "number",
          title: "等级",
          default: 5,
          "x-decorator": "FormItem",
          "x-component": "Slider",
          "x-component-props": { min: 0, max: 10, step: 1 },
        },
      },
    })

    expect(form.values.level).toBe(5)
    await t.press(KeyCodes.ARROW_RIGHT)
    await t.waitUntil(() => form.values.level === 6)
    expect(t.frame()).toContain("6")
    t.destroy()
  })
})
