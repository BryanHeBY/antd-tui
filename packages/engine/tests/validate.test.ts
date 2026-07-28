import { describe, expect, test } from "bun:test"
import { validatePageSchema } from "../src/validate"

/**
 * validate 单元测试：信封协议的结构校验（scope 段、page.mode 等）。
 * 白名单遍历与 CLI 退出码由 e2e.cli.test.ts 覆盖。
 */

const WHITELIST = ["Button", "ResultText"]

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

describe("theme 段校验", () => {
  test("合法 theme：token 覆盖种子色", () => {
    const r = validatePageSchema(
      base({ theme: { token: { colorPrimary: "#722ed1", padding: 1 } } }),
      WHITELIST,
    )
    expect(r.ok).toBe(true)
  })

  test("theme 缺省合法、空对象合法", () => {
    expect(validatePageSchema(base({}), WHITELIST).ok).toBe(true)
    expect(validatePageSchema(base({ theme: {} }), WHITELIST).ok).toBe(true)
  })

  test("theme 非对象报错", () => {
    const r = validatePageSchema(base({ theme: "dark" }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/theme")
  })

  test("theme.token 非对象报错", () => {
    const r = validatePageSchema(base({ theme: { token: ["#fff"] } }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/theme/token")
  })

  test("theme.token 值非字符串/数字报错并带键名路径", () => {
    const r = validatePageSchema(
      base({ theme: { token: { colorPrimary: { hex: "#fff" } } } }),
      WHITELIST,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/theme/token/colorPrimary")
  })

  test("颜色键非法 hex 报错（防 #NaNNaN 静默渲染），transparent 合法", () => {
    const bad = validatePageSchema(
      base({ theme: { token: { colorPrimary: "blue" } } }),
      WHITELIST,
    )
    expect(bad.ok).toBe(false)
    expect(bad.errors[0]).toContain("/theme/token/colorPrimary")

    const ok = validatePageSchema(
      base({ theme: { token: { colorPrimary: "#722ed1", colorBgContainer: "transparent" } } }),
      WHITELIST,
    )
    expect(ok.ok).toBe(true)
  })

  test("borderStyle 非枚举值报错", () => {
    const r = validatePageSchema(base({ theme: { token: { borderStyle: "dotted" } } }), WHITELIST)
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toContain("/theme/token/borderStyle")
  })
})
