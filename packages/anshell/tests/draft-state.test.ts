import { describe, expect, test } from "bun:test"
import { draftReducer, initialDraftState } from "../src/ui/draft-state"

describe("draftReducer", () => {
  test("修改输入时清理上一次派生的诊断和补全", () => {
    const populated = {
      ...initialDraftState,
      input: "ec",
      diagnostic: { kind: "invalid" as const, message: "bad" },
      completions: [{ value: "echo", label: "echo", kind: "command" as const }],
    }

    expect(draftReducer(populated, { type: "change", input: "echo" })).toEqual({
      ...initialDraftState,
      input: "echo",
    })
  })

  test("切换路由时保留输入并清理 Shell 派生状态", () => {
    const populated = {
      ...initialDraftState,
      input: "解释这个项目",
      completions: [{ value: "example", label: "example", kind: "command" as const }],
    }

    expect(draftReducer(populated, { type: "route", route: "agent" })).toEqual({
      ...initialDraftState,
      input: "解释这个项目",
      routeOverride: "agent",
    })
  })

  test("提交或取消时复位整个草稿状态", () => {
    const populated = {
      ...initialDraftState,
      input: "echo ok",
      routeOverride: "shell" as const,
      diagnostic: { kind: "incomplete" as const, message: "quote" },
    }

    expect(draftReducer(populated, { type: "reset" })).toEqual(initialDraftState)
  })
})
