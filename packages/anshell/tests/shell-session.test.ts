import { afterEach, describe, expect, test } from "bun:test"
import { createShellSession, type ShellSession } from "../src/shell/session"
import { screenToText } from "@antd-tui/anterm"

let active: ShellSession | null = null
afterEach(() => {
  active?.kill()
  active = null
})

async function waitUntil(predicate: () => boolean, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待超时")
    await new Promise((r) => setTimeout(r, 15))
  }
}

interface Recorder {
  ready: boolean
  starts: Array<{ row: number; col: number }>
  ends: Array<{ exitCode: number; row: number; col: number }>
  cwds: string[]
  exited: number | null
}

function start(): { session: ShellSession; rec: Recorder } {
  const rec: Recorder = { ready: false, starts: [], ends: [], cwds: [], exited: null }
  const session = createShellSession({
    path: "/bin/bash",
    dialect: "bash",
    cwd: process.cwd(),
    cols: 60,
    rows: 20,
    init: "minimal",
    events: {
      onReady: () => (rec.ready = true),
      onCommandStart: (s) => rec.starts.push({ row: s.row, col: s.col }),
      onCommandEnd: (end) => rec.ends.push(end),
      onCwd: (cwd) => rec.cwds.push(cwd),
      onExit: (code) => (rec.exited = code),
    },
  })
  active = session
  return { session, rec }
}

/** 命令输出区间的文本（复刻 useShellSession 里快照器的取法）。 */
function rangeText(session: ShellSession, start: { row: number; col: number }, end: { row: number; col: number }): string[] {
  const startY = start.col === 0 ? start.row : start.row + 1
  const endExclusive = end.col === 0 ? end.row : end.row + 1
  return screenToText(session.anterm.normalScreen, { startY, rows: Math.max(0, endExclusive - startY) })
}

describe("createShellSession (bash)", () => {
  test("就绪后 echo 的区间只含输出，排除 prompt 与回显", async () => {
    const { session, rec } = start()
    await waitUntil(() => rec.ready)
    session.submit("echo one; echo two")
    await waitUntil(() => rec.ends.length === 1)
    expect(rec.starts).toHaveLength(1)
    expect(rec.ends[0]!.exitCode).toBe(0)
    const text = rangeText(session, rec.starts[0]!, rec.ends[0]!)
    expect(text).toEqual(["one", "two"])
  })

  test("退出码、cwd、空输出都对得上", async () => {
    const { session, rec } = start()
    await waitUntil(() => rec.ready)
    session.submit("false")
    await waitUntil(() => rec.ends.length === 1)
    expect(rec.ends[0]!.exitCode).toBe(1)

    session.submit("cd /tmp")
    await waitUntil(() => rec.cwds.includes("/tmp"))
    expect(rec.cwds.at(-1)).toBe("/tmp")
  })

  test("runHidden 复用同一 shell，不产生命令卡片且保留用户退出码", async () => {
    const { session, rec } = start()
    await waitUntil(() => rec.ready)
    session.submit("false")
    await waitUntil(() => rec.ends.length === 1)
    const startsBefore = rec.starts.length
    const out = await session.runHidden("echo hidden-output", { timeoutMs: 6000 })
    expect(out).toBe("hidden-output")
    expect(rec.starts.length).toBe(startsBefore) // 静默命令不触发 onCommandStart

    // 保证：静默命令之后，下一条真实命令仍看到 false 的退出码
    session.submit("echo $?")
    await waitUntil(() => rec.ends.length === 2)
    expect(rangeText(session, rec.starts.at(-1)!, rec.ends.at(-1)!)).toEqual(["1"])
  })

  test("shell 退出触发 onExit", async () => {
    const { session, rec } = start()
    await waitUntil(() => rec.ready)
    session.submit("exit")
    await waitUntil(() => rec.exited !== null)
    expect(rec.exited).toBe(0)
  })
})
