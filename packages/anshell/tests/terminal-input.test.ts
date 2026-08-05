import { describe, expect, test } from "bun:test"
import type { ParsedKey } from "@opentui/core"
import { TerminalInputHandoff, type TerminalInputSession } from "../src/terminal-input"

function key(overrides: Partial<ParsedKey> = {}): ParsedKey {
  return {
    name: "x",
    raw: "x",
    sequence: "x",
    ctrl: false,
    shift: false,
    meta: false,
    option: false,
    source: "legacy",
    eventType: "press",
    ...overrides,
  } as ParsedKey
}

function session(options: { applicationCursorKeys?: boolean; bracketedPaste?: boolean } = {}) {
  const writes: string[] = []
  const value: TerminalInputSession = {
    applicationCursorKeys: options.applicationCursorKeys ?? false,
    bracketedPaste: options.bracketedPaste ?? false,
    write: (data) => writes.push(data),
  }
  return { value, writes }
}

describe("TerminalInputHandoff", () => {
  test("session 创建前排队，attach 后按原顺序冲刷", () => {
    const handoff = new TerminalInputHandoff()
    const target = session()
    handoff.begin()
    handoff.writeKey(key({ raw: "a", sequence: "a" }))
    handoff.writePaste("paste")
    expect(target.writes).toEqual([])

    handoff.attach(target.value)
    expect(target.writes).toEqual(["a", "paste"])
    expect(handoff.active).toBe(true)
  })

  test("就绪后使用 session 模式编码按键与粘贴", () => {
    const handoff = new TerminalInputHandoff()
    const target = session({ applicationCursorKeys: true, bracketedPaste: true })
    handoff.begin()
    handoff.attach(target.value)
    handoff.writeKey(key({ name: "right", raw: "\x1b[C", sequence: "\x1b[C" }))
    handoff.writePaste("one\ntwo")
    expect(target.writes).toEqual(["\x1bOC", "\x1b[200~one\ntwo\x1b[201~"])
  })

  test("只允许当前 session 释放输入所有权", () => {
    const handoff = new TerminalInputHandoff()
    const current = session()
    const stale = session()
    handoff.begin()
    handoff.attach(current.value)

    expect(handoff.release(stale.value)).toBe(false)
    expect(handoff.active).toBe(true)
    expect(handoff.release(current.value)).toBe(true)
    expect(handoff.active).toBe(false)
  })
})
