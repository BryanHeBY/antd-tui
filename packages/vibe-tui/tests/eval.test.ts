import { describe, expect, test } from "bun:test"
import { createEvalRepl } from "../src/eval"

describe("vibetui_eval 会话级 REPL", () => {
  test("顶层变量、函数与闭包跨 evaluate 调用保留", () => {
    const ui = { data: { count: 0 } }
    const repl = createEvalRepl({ $ui: ui })

    repl.evaluate(`
      const label = "count"
      let step = 2
      const actions = {
        increase: () => ($ui.data.count += step),
        summary: () => \`${"${label}"}:${"${$ui.data.count}"}\`,
      }
    `)

    expect(repl.evaluate("actions.increase()")).toBe(2)
    expect(repl.evaluate("step = 5; actions.increase()")).toBe(7)
    expect(repl.evaluate("actions.summary()")).toBe("count:7")
  })

  test("var 可用于可重复执行的初始化，而 REPL 彼此隔离", () => {
    const first = createEvalRepl({ $ui: { data: {} } })
    const second = createEvalRepl({ $ui: { data: {} } })

    expect(first.evaluate("var renders = 1; renders")).toBe(1)
    expect(first.evaluate("var renders = renders + 1; renders")).toBe(2)
    expect(() => second.evaluate("renders")).toThrow("renders is not defined")
  })

  test("reset 只丢弃 REPL 顶层作用域，保留固定宿主入口", () => {
    const ui = { data: { count: 1 } }
    const repl = createEvalRepl({ $ui: ui })
    repl.evaluate("const stale = 42; $ui.data.count = 7")

    repl.reset()

    expect(() => repl.evaluate("stale")).toThrow("stale is not defined")
    expect(repl.evaluate("$ui.data.count")).toBe(7)
    expect(repl.evaluate("const fresh = 1; fresh")).toBe(1)
  })

  test("宿主入口可用但不能被 REPL 重绑定", () => {
    const ui = { data: { count: 1 } }
    const repl = createEvalRepl({ $ui: ui })

    expect(repl.evaluate("$ui.data.count += 1")).toBe(2)
    expect(repl.evaluate("$ui = null; $ui.data.count")).toBe(2)
    expect(ui.data.count).toBe(2)
    // 保持旧版 new Function 的语义：agent 可以执行宿主运行时可见的任意 JS。
    expect(repl.evaluate("typeof Bun")).toBe("object")
  })

  test("异常不会回滚本次 eval 中此前已完成的 $ui 修改", () => {
    const nodes: string[] = []
    const repl = createEvalRepl({ $ui: { add: (id: string) => nodes.push(id) } })

    expect(() => repl.evaluate('$ui.add("first"); throw new Error("stop")')).toThrow("stop")
    expect(nodes).toEqual(["first"])
  })
})
