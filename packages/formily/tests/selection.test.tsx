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

describe("Checkbox.Group", () => {
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
          "x-component": "Checkbox.Group",
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

describe("Radio.Group", () => {
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
          "x-component": "Radio.Group",
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
          "x-content": "同意条款",
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

  test("外部 value 更新会回写终端缓冲区", async () => {
    const form = createForm({ initialValues: { note: "初始内容" } })
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        note: { type: "string", "x-component": "TextArea" },
      },
    })

    expect(t.frame()).toContain("初始内容")
    form.setValuesIn("note", "联动后的内容")
    await t.waitUntil(() => t.frame().includes("联动后的内容"))
    t.destroy()
  })
})

describe("options 透传", () => {
  test("未使用 enum 时保留 Select 的 x-component-props.options", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        env: {
          type: "string",
          "x-component": "Select",
          "x-component-props": {
            options: [
              { label: "开发", value: "dev" },
              { label: "生产", value: "prod" },
            ],
          },
        },
      },
    })

    expect(t.frame()).toContain("开发")
    expect(t.frame()).toContain("生产")
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
