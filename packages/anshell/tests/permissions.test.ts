import { describe, expect, test } from "bun:test"
import { outcomeOfKind, PermissionPolicy, type PolicyOption } from "../src/agent/permissions"
import { toolLines } from "../src/agent/tool-content"

const options: PolicyOption[] = [
  { optionId: "once", name: "允许一次", kind: "allow_once" },
  { optionId: "always", name: "总是允许", kind: "allow_always" },
  { optionId: "never", name: "总是拒绝", kind: "reject_always" },
]

describe("PermissionPolicy", () => {
  test("once 类决策只留审计，不写记忆", () => {
    const policy = new PermissionPolicy()
    policy.record("删除文件", options[0]!, "allowed", false)
    expect(policy.lookup("删除文件", options)).toBeNull()
    expect(policy.records).toHaveLength(1)
    expect(policy.records[0]).toMatchObject({ seq: 1, tool: "删除文件", outcome: "allowed", auto: false })
  })

  test("always 类决策写进记忆，下次同名工具直接命中", () => {
    const policy = new PermissionPolicy()
    policy.record("删除文件", options[1]!, "allowed", false)
    expect(policy.lookup("删除文件", options)).toMatchObject({ kind: "allow_always", optionId: "always" })
    expect(policy.lookup("别的工具", options)).toBeNull()
  })

  test("reject_always 同样被记住", () => {
    const policy = new PermissionPolicy()
    policy.record("删除文件", options[2]!, "rejected", false)
    expect(policy.lookup("删除文件", options)?.kind).toBe("reject_always")
  })

  test("agent 换了选项集时记忆失效，重新问人", () => {
    const policy = new PermissionPolicy()
    policy.record("删除文件", options[1]!, "allowed", false)
    expect(policy.lookup("删除文件", [{ optionId: "other", name: "别的", kind: "allow_once" }])).toBeNull()
  })

  test("forget 清记忆但保留审计流水", () => {
    const policy = new PermissionPolicy()
    policy.record("a", options[1]!, "allowed", false)
    policy.record("b", options[1]!, "allowed", true)
    expect(policy.forget()).toBe(2)
    expect(policy.memory.size).toBe(0)
    expect(policy.records).toHaveLength(2)
  })

  test("取消也留痕", () => {
    const policy = new PermissionPolicy()
    const record = policy.record("危险操作", null, "cancelled", false)
    expect(record).toMatchObject({ kind: "cancelled", outcome: "cancelled" })
  })

  test("outcomeOfKind 按 allow/reject 前缀判断", () => {
    expect(outcomeOfKind("allow_once")).toBe("allowed")
    expect(outcomeOfKind("allow_always")).toBe("allowed")
    expect(outcomeOfKind("reject_once")).toBe("rejected")
  })
})

describe("toolLines", () => {
  test("文本内容按行展开", () => {
    expect(toolLines([{ type: "content", content: { type: "text", text: "a\nb" } }])).toEqual(["a", "b"])
  })

  test("diff 只给路径与行数", () => {
    expect(toolLines([{ type: "diff", path: "src/x.ts", oldText: "1\n2", newText: "1\n2\n3" }]))
      .toEqual(["diff src/x.ts  +3 -2"])
  })

  test("terminal 留下 id", () => {
    expect(toolLines([{ type: "terminal", terminalId: "t1" }])).toEqual(["terminal t1"])
  })

  test("超长输出被截断并告知剩余行数", () => {
    const text = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n")
    const lines = toolLines([{ type: "content", content: { type: "text", text } }])
    expect(lines).toHaveLength(13)
    expect(lines.at(-1)).toBe("… 另有 8 行")
  })

  test("没有 content 时是空数组", () => {
    expect(toolLines(undefined)).toEqual([])
    expect(toolLines(null)).toEqual([])
  })
})
