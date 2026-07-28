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
})
