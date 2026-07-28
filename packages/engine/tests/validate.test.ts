import { describe, expect, test } from "bun:test"
import { validatePageSchema } from "../src/validate"

/**
 * validate 单元测试：信封协议的结构校验（scope 段、page.mode 等）。
 * 白名单遍历与 CLI 退出码由 e2e.cli.test.ts 覆盖。
 */

const WHITELIST = ["Button", "Typography.Text"]

function base(extra: Record<string, unknown>) {
  return { version: "0.1", form: { type: "object" }, ...extra }
}

describe("page.mode 校验", () => {
  test("form / interactive / 缺省均合法", () => {
    expect(validatePageSchema(base({ page: { mode: "form" } }), WHITELIST).ok).toBe(true)
    expect(validatePageSchema(base({ page: { mode: "interactive" } }), WHITELIST).ok).toBe(true)
    expect(validatePageSchema(base({ page: { title: "t" } }), WHITELIST).ok).toBe(true)
  })

  test("非法 mode 报错", () => {
    const r = validatePageSchema(base({ page: { mode: "popup" } }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/page/mode")
  })

  test("actions 为空数组不再有特殊语义（仍合法，等同缺省）", () => {
    expect(validatePageSchema(base({ actions: [] }), WHITELIST).ok).toBe(true)
  })
})

describe("scope 段校验", () => {
  test("合法 scope：函数名到表达式字符串的映射", () => {
    const r = validatePageSchema(
      base({ scope: { pressDigit: "{{ (d) => d }}", evaluate: "{{ () => 0 }}" } }),
      WHITELIST,
    )
    expect(r.ok).toBe(true)
  })

  test("scope 非对象报错", () => {
    const r = validatePageSchema(base({ scope: ["{{ () => 0 }}"] }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/scope")
  })

  test("scope 值非字符串报错并带函数名路径", () => {
    const r = validatePageSchema(base({ scope: { evaluate: 42 } }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/scope/evaluate")
  })

  test("scope 表达式未包裹 {{ }} 报错", () => {
    const r = validatePageSchema(base({ scope: { fn: "() => 0" } }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/scope/fn")
    expect(r.errors[0]).toContain("{{ }}")
  })
})

describe("未知键拒绝", () => {
  test("信封层 typo（scopes）报错并列出可用键", () => {
    const r = validatePageSchema(base({ scopes: {} }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/scopes")
    expect(r.errors[0]).toContain("未知键")
  })

  test("page 与 actions 的未知键报错", () => {
    const r1 = validatePageSchema(base({ page: { titel: "t" } }), WHITELIST)
    expect(r1.ok).toBe(false)
    expect(r1.errors[0]).toContain("/page/titel")

    const r2 = validatePageSchema(base({ actions: [{ type: "submit", lable: "x" }] }), WHITELIST)
    expect(r2.ok).toBe(false)
    expect(r2.errors[0]).toContain("/actions/0/lable")
  })

  test("字段节点 typo（x-comopnent-props）报错", () => {
    const r = validatePageSchema(
      base({
        form: {
          type: "object",
          properties: { a: { type: "void", "x-component": "Button", "x-comopnent-props": {} } },
        },
      }),
      WHITELIST,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/form/properties/a/x-comopnent-props")
  })
})

describe("表达式静态检查", () => {
  test("语法错误在 dry-run 阶段报出", () => {
    const r = validatePageSchema(
      base({ scope: { bad: "{{ () => { const } }}" } }),
      WHITELIST,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/scope/bad")
    expect(r.errors[0]).toContain("语法错误")
  })

  test("调用未定义的 scope 函数报错（含 props 深层表达式）", () => {
    const r = validatePageSchema(
      base({
        scope: { pressDigit: "{{ (d) => d }}" },
        form: {
          type: "object",
          properties: {
            btn: {
              type: "void",
              "x-component": "Button",
              "x-component-props": { tuiOnClick: "{{ () => pressDigt('7') }}" },
            },
          },
        },
      }),
      WHITELIST,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("pressDigt")
  })

  test("合法表达式不误报：scope 互调、内置全局、字符串里的括号", () => {
    const r = validatePageSchema(
      base({
        scope: {
          a: "{{ () => b() + Math.min(1, 2) }}",
          b: "{{ () => { const f = () => 1; return f() } }}",
          c: "{{ () => '文案里有 run() 也不报' }}",
        },
      }),
      WHITELIST,
    )
    expect(r.errors).toEqual([])
    expect(r.ok).toBe(true)
  })
})

describe("字段结构深化", () => {
  test("非法 type 报错", () => {
    const r = validatePageSchema(
      base({ form: { type: "object", properties: { a: { type: "int" } } } }),
      WHITELIST,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/form/properties/a/type")
  })

  test("enum 非数组、required 非布尔、props 非对象均报错", () => {
    const r = validatePageSchema(
      base({
        form: {
          type: "object",
          properties: {
            a: { type: "string", enum: "dev,test", required: "yes", "x-component-props": [] },
          },
        },
      }),
      WHITELIST,
    )
    expect(r.ok).toBe(false)
    const all = r.errors.join("\n")
    expect(all).toContain("/form/properties/a/enum")
    expect(all).toContain("/form/properties/a/required")
    expect(all).toContain("/form/properties/a/x-component-props")
  })

  test("x-reactions 非对象报错", () => {
    const r = validatePageSchema(
      base({
        form: { type: "object", properties: { a: { type: "string", "x-reactions": "visible" } } },
      }),
      WHITELIST,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/form/properties/a/x-reactions")
  })
})

describe("组件 props 键白名单", () => {
  const PROPS = { Button: ["type", "tuiOnClick", "tuiHotkey"] as const }

  test("未知 prop 键报错并列出可用键", () => {
    const r = validatePageSchema(
      base({
        form: {
          type: "object",
          properties: {
            a: { type: "void", "x-component": "Button", "x-component-props": { onclick: "{{ () => 0 }}" } },
          },
        },
      }),
      WHITELIST,
      PROPS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/form/properties/a/x-component-props/onclick")
    expect(r.errors[0]).toContain("tuiOnClick")
  })

  test("合法键通过；未提供白名单的组件不校验键", () => {
    const ok = validatePageSchema(
      base({
        form: {
          type: "object",
          properties: {
            a: { type: "void", "x-component": "Button", "x-component-props": { tuiHotkey: "a" } },
            b: { type: "string", "x-component": "Typography.Text", "x-component-props": { anything: 1 } },
          },
        },
      }),
      WHITELIST,
      PROPS,
    )
    expect(ok.errors).toEqual([])
  })
})

describe("state 段校验", () => {
  test("合法 state：任意初值对象", () => {
    const r = validatePageSchema(
      base({ state: { current: 0, cpu: 42, loading: false } }),
      WHITELIST,
    )
    expect(r.ok).toBe(true)
  })

  test("state 非对象报错", () => {
    const r = validatePageSchema(base({ state: [1, 2] }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/state")
  })
})

describe("tuiTheme 段校验", () => {
  test("旧 theme 字段被拒绝，避免与 antd ConfigProvider.theme 混淆", () => {
    const r = validatePageSchema(base({ theme: { token: { colorPrimary: "#722ed1" } } }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain('/theme')
    expect(r.errors[0]).toContain('tuiTheme')
  })

  test("合法 tuiTheme：token 覆盖种子色", () => {
    const r = validatePageSchema(
      base({ tuiTheme: { token: { colorPrimary: "#722ed1", padding: 1 } } }),
      WHITELIST,
    )
    expect(r.ok).toBe(true)
  })

  test("tuiTheme 缺省合法、空对象合法", () => {
    expect(validatePageSchema(base({}), WHITELIST).ok).toBe(true)
    expect(validatePageSchema(base({ tuiTheme: {} }), WHITELIST).ok).toBe(true)
  })

  test("tuiTheme 非对象报错", () => {
    const r = validatePageSchema(base({ tuiTheme: "dark" }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/tuiTheme")
  })

  test("tuiTheme.token 非对象报错", () => {
    const r = validatePageSchema(base({ tuiTheme: { token: ["#fff"] } }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/tuiTheme/token")
  })

  test("tuiTheme.token 值非字符串/数字报错并带键名路径", () => {
    const r = validatePageSchema(
      base({ tuiTheme: { token: { colorPrimary: { hex: "#fff" } } } }),
      WHITELIST,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/tuiTheme/token/colorPrimary")
  })

  test("颜色键非法 hex 报错（防 #NaNNaN 静默渲染），transparent 合法", () => {
    const bad = validatePageSchema(
      base({ tuiTheme: { token: { colorPrimary: "blue" } } }),
      WHITELIST,
    )
    expect(bad.ok).toBe(false)
    expect(bad.errors[0]).toContain("/tuiTheme/token/colorPrimary")

    const ok = validatePageSchema(
      base({ tuiTheme: { token: { colorPrimary: "#722ed1", colorBgContainer: "transparent" } } }),
      WHITELIST,
    )
    expect(ok.ok).toBe(true)
  })

  test("borderStyle 非枚举值报错", () => {
    const r = validatePageSchema(base({ tuiTheme: { token: { borderStyle: "dotted" } } }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/tuiTheme/token/borderStyle")
  })
})
