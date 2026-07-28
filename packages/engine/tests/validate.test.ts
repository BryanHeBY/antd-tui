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
