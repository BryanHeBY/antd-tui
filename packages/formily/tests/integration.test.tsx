import { describe, expect, test } from "bun:test"
import { createForm } from "@formily/core"
import { renderTui } from "@antd-tui/test-utils"
import { ConfigProvider, FocusScope } from "@antd-tui/components"
import { FormProvider, SchemaField } from "../src/index"

/**
 * 集成测试：Formily 表单模型 × antd-tui 组件 × OpenTUI 渲染。
 * 覆盖：schema 渲染、受控输入回填、enum → Select、x-reactions 联动、必填校验。
 */

function renderSchema(form: ReturnType<typeof createForm>, schema: object) {
  return renderTui(
    <ConfigProvider>
      <FocusScope>
        <FormProvider form={form}>
          <SchemaField schema={schema as never} />
        </FormProvider>
      </FocusScope>
    </ConfigProvider>,
    { width: 50, height: 24 },
  )
}

describe("SchemaField 渲染", () => {
  test("schema 字段渲染为 TUI 控件，输入写回 form.values", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        username: {
          type: "string",
          title: "用户名",
          "x-decorator": "FormItem",
          "x-component": "Input",
          "x-component-props": { placeholder: "输入用户名" },
        },
      },
    })

    expect(t.frame()).toContain("用户名")
    expect(t.frame()).toContain("输入用户名")

    await t.type("admin")
    expect(form.values.username).toBe("admin")
    // 受控回显
    expect(t.frame()).toContain("admin")
    t.destroy()
  })

  test("enum 渲染为 Select 且 default 生效", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        color: {
          type: "string",
          title: "颜色",
          default: "red",
          enum: [
            { label: "红色", value: "red" },
            { label: "蓝色", value: "blue" },
          ],
          "x-decorator": "FormItem",
          "x-component": "Select",
        },
      },
    })

    expect(t.frame()).toContain("红色")
    expect(t.frame()).toContain("蓝色")
    expect(form.values.color).toBe("red")
    t.destroy()
  })
})

describe("x-reactions 联动", () => {
  test("依赖字段变化时表达式重新计算", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        n: {
          type: "number",
          title: "数字",
          "x-decorator": "FormItem",
          "x-component": "InputNumber",
        },
        double: {
          type: "string",
          title: "两倍",
          "x-decorator": "FormItem",
          "x-component": "Typography.Text",
          "x-reactions": {
            dependencies: ["n"],
            fulfill: {
              state: {
                value: "{{ $deps[0] === undefined ? '' : String($deps[0] * 2) }}",
              },
            },
          },
        },
      },
    })

    await t.type("21")
    await t.waitUntil(() => form.values.double === "42")
    expect(t.frame()).toContain("42")
    t.destroy()
  })
})

describe("校验", () => {
  test("必填字段为空时 submit 拒绝，错误显示在界面上", async () => {
    const form = createForm()
    const t = await renderSchema(form, {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "姓名",
          required: true,
          "x-decorator": "FormItem",
          "x-component": "Input",
        },
      },
    })

    let rejected = false
    await form.submit(() => {}).catch(() => (rejected = true))
    expect(rejected).toBe(true)

    await t.settle()
    // Formily 默认错误信息包含字段标题
    expect(t.frame()).toMatch(/必填|required|姓名/)
    t.destroy()
  })
})
