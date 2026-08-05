import { describe, expect, test } from "bun:test"
import { createAntermSession, type AntermSession } from "../src/index"

async function waitUntil(predicate: () => boolean, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("等待超时")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function textOf(session: AntermSession, row: number): string {
  const { screen } = session
  let out = ""
  for (let x = 0; x < screen.cols; x++) {
    const cell = screen.getCell(screen.viewportY + row, x)
    if (!cell) break
    if (cell.width === 0) continue
    out += cell.chars || " "
  }
  return out.trimEnd()
}

describe("createAntermSession", () => {
  test("子进程拿到真 TTY 与指定的窗口尺寸", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["-c", 'tput cols; tput lines; [ -t 1 ] && echo TTY || echo NOTTY'],
      cols: 100,
      rows: 30,
    })
    try {
      await waitUntil(() => textOf(session, 2) === "TTY")
      expect(textOf(session, 0)).toBe("100")
      expect(textOf(session, 1)).toBe("30")
    } finally {
      session.kill()
    }
  })

  test("onExit 收到子进程退出码", async () => {
    const result: { code: number | null } = { code: null }
    const session = createAntermSession({
      command: "bash",
      args: ["-c", "exit 7"],
      cols: 20,
      rows: 4,
      onExit: (c) => {
        result.code = c
      },
    })
    try {
      await waitUntil(() => result.code !== null)
      expect(result.code).toBe(7)
      expect(session.exited).toBe(true)
    } finally {
      session.kill()
    }
  })

  test("write 的输入被子进程回显", async () => {
    const session = createAntermSession({ command: "cat", cols: 30, rows: 4 })
    try {
      session.write("ping\r")
      await waitUntil(() => textOf(session, 0).includes("ping"))
      expect(textOf(session, 0)).toContain("ping")
    } finally {
      session.kill()
    }
  })

  test("onFrame 在屏幕变化后触发", async () => {
    const session = createAntermSession({ command: "cat", cols: 30, rows: 4 })
    let frames = 0
    const unsubscribe = session.onFrame(() => {
      frames++
    })
    try {
      session.write("x\r")
      await waitUntil(() => frames > 0)
      expect(frames).toBeGreaterThan(0)
    } finally {
      unsubscribe()
      session.kill()
    }
  })

  test("resize 同步到 pty 与 VT 两侧", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["--norc", "-i"],
      cols: 40,
      rows: 10,
    })
    try {
      session.resize(90, 24)
      expect(session.screen.cols).toBe(90)
      expect(session.screen.rows).toBe(24)
      session.write("tput cols\r")
      await waitUntil(() => {
        for (let y = 0; y < 24; y++) if (textOf(session, y) === "90") return true
        return false
      })
    } finally {
      session.kill()
    }
  })

  test("模式标志随子进程的 DECSET 协商变化", async () => {
    const session = createAntermSession({
      command: "bash",
      // 必须由子进程自己把序列打到 stdout：pty 的本地回显会把 ESC 变成 "^["
      args: ["-c", String.raw`printf '\033[?1002h\033[?1006h\033[?1h\033[?2004h'; sleep 5`],
      cols: 30,
      rows: 4,
    })
    try {
      await waitUntil(() => session.mouseTracking !== "none")
      expect(session.mouseTracking).toBe("drag")
      expect(session.sgrMouse).toBe(true)
      expect(session.applicationCursorKeys).toBe(true)
      expect(session.bracketedPaste).toBe(true)
    } finally {
      session.kill()
    }
  })

  test("未协商时模式标志都是关闭的", () => {
    const session = createAntermSession({ command: "cat", cols: 30, rows: 4 })
    try {
      expect(session.mouseTracking).toBe("none")
      expect(session.sgrMouse).toBe(false)
      expect(session.applicationCursorKeys).toBe(false)
      expect(session.bracketedPaste).toBe(false)
    } finally {
      session.kill()
    }
  })

  test("合并参数的 DECSET 也能识别出 SGR 鼠标编码", async () => {
    const session = createAntermSession({
      command: "bash",
      // htop 实际发的是合并形式；漏判会退化成 X10 编码而被子进程读成按键
      args: ["-c", String.raw`printf '\033[?1006;1000h'; sleep 5`],
      cols: 30,
      rows: 4,
    })
    try {
      await waitUntil(() => session.mouseTracking !== "none")
      expect(session.mouseTracking).toBe("vt200")
      expect(session.sgrMouse).toBe(true)
    } finally {
      session.kill()
    }
  })

  test("Ctrl-C 产生 SIGINT 而不只是回显 ^C", async () => {
    // Bun 的 spawn({ terminal }) 不建立控制终端，需要 setsid --ctty 兜上
    if (process.platform !== "linux" || !Bun.which("setsid")) return
    const session = createAntermSession({
      command: "bash",
      args: ["-c", 'trap "echo GOT_SIGINT" INT; echo READY; while :; do sleep 0.2; done'],
      cols: 30,
      rows: 4,
    })
    try {
      await waitUntil(() => textOf(session, 0).includes("READY"))
      session.write("\x03")
      await waitUntil(() => textOf(session, 1).includes("GOT_SIGINT"))
      expect(textOf(session, 1)).toContain("GOT_SIGINT")
    } finally {
      session.kill()
    }
  })

  test("kill 之后不再触发帧通知", async () => {
    const session = createAntermSession({ command: "cat", cols: 20, rows: 4 })
    let frames = 0
    session.onFrame(() => {
      frames++
    })
    session.write("a\r")
    await waitUntil(() => frames > 0)
    session.kill()
    const settled = frames
    session.write("b\r")
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(frames).toBe(settled)
  })
})
