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

  test("onFrame 触发时 xterm buffer 已完成对应输出的解析", async () => {
    const session = createAntermSession({ command: "cat", cols: 40, rows: 6 })
    let observedChildOutput = false
    const unsubscribe = session.onFrame(() => {
      let matches = 0
      for (let y = 0; y < session.screen.rows; y++) {
        if (textOf(session, y) === "parsed-before-frame") matches++
      }
      // 一行来自终端本地回显，另一行来自 cat；后者不能只存在于尚未解析的 write 队列。
      if (matches >= 2) observedChildOutput = true
    })
    try {
      session.write("parsed-before-frame\r")
      await waitUntil(() => observedChildOutput)
      expect(observedChildOutput).toBe(true)
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

  test("alternate screen 状态跟随 1049 模式切换", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["-c", String.raw`printf '\033[?1049h\033[2JALT'; sleep 0.2; printf '\033[?1049l'; sleep 1`],
      cols: 30,
      rows: 6,
    })
    try {
      await waitUntil(() => session.alternateScreen)
      expect(session.screen).not.toBe(session.normalScreen)
      expect(session.screenTakeover).toBe(false)
      await waitUntil(() => !session.alternateScreen)
      expect(session.screenTakeover).toBe(false)
    } finally {
      session.kill()
    }
  })

  test("OSC 7/133 转发给宿主并带上解析当刻的行列", async () => {
    const session = createAntermSession({
      command: "bash",
      args: [
        "-c",
        String.raw`printf 'first
'; printf ']133;A$ ]133;Becho hi
'; printf ']133;Chi
'; printf ']133;D;0]7;file://h/tmp'; sleep 1`,
      ],
      cols: 30,
      rows: 6,
    })
    const events: Array<{ ident: number; data: string; row: number; col: number }> = []
    const unsubscribe = session.onOsc((event) => {
      events.push({ ident: event.ident, data: event.data, row: event.row, col: event.col })
    })
    try {
      await waitUntil(() => events.some((e) => e.ident === 7))
      const marks = events.filter((e) => e.ident === 133).map((e) => e.data)
      expect(marks).toEqual(["A", "B", "C", "D;0"])
      // A/B 落在 prompt 行，C 落在输出首行，D 落在输出之后——这正是切区间要的边界
      const at = (data: string) => events.find((e) => e.ident === 133 && e.data === data)!
      expect(at("A").row).toBe(1)
      expect(at("B").col).toBeGreaterThan(0)
      expect(at("C").row).toBe(2)
      expect(at("D;0").row).toBe(3)
      expect(events.find((e) => e.ident === 7)!.data).toBe("file://h/tmp")
      // 序列本身不会进 buffer
      expect(textOf(session, 1)).toBe("$ echo hi")
      expect(textOf(session, 2)).toBe("hi")
    } finally {
      unsubscribe()
      session.kill()
    }
  })

  test("被读缓冲切断的 OSC 仍只触发一次（xterm 自己攒完整载荷）", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["-c", String.raw`printf ']133;'; sleep 0.3; printf 'D;7'; sleep 1`],
      cols: 30,
      rows: 4,
    })
    const events: string[] = []
    const unsubscribe = session.onOsc((event) => events.push(event.data))
    try {
      await waitUntil(() => events.length > 0)
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(events).toEqual(["D;7"])
    } finally {
      unsubscribe()
      session.kill()
    }
  })

  test("OSC 标记建出的行引用随 scrollback 裁剪自动下移", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["-c", String.raw`printf 'MARKED
'; printf ']133;C'; sleep 0.2; seq 1 40; sleep 1`],
      cols: 30,
      rows: 4,
      scrollback: 5,
    })
    let mark: { row: number } | null = null
    const unsubscribe = session.onOsc((event) => {
      if (event.data === "C") mark = event.createMark()
    })
    try {
      await waitUntil(() => mark !== null)
      const first = mark!.row
      await waitUntil(() => mark!.row < first)
      // 行号被裁剪推着往下走，而不是指向别的内容
      expect(mark!.row).toBeLessThan(first)
    } finally {
      unsubscribe()
      session.kill()
    }
  })

  test("整屏清除的代数逐次递增，长驻会话可按命令比较", async () => {
    const session = createAntermSession({
      command: "bash",
      args: [
        "-c",
        String.raw`printf 'a'; printf '[2J'; sleep 0.2; printf 'b'; printf '[2J'; sleep 1`,
      ],
      cols: 30,
      rows: 4,
    })
    try {
      await waitUntil(() => session.screenTakeoverSeq === 1)
      await waitUntil(() => session.screenTakeoverSeq === 2)
      expect(session.screenTakeover).toBe(true)
    } finally {
      session.kill()
    }
  })

  test("kill 之后不再转发 OSC", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["-c", String.raw`sleep 0.2; printf ']133;A'; sleep 1`],
      cols: 20,
      rows: 4,
    })
    const events: string[] = []
    session.onOsc((event) => events.push(event.data))
    session.kill()
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(events).toEqual([])
  })

  test("normal buffer 的整屏清除被识别为 screen takeover", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["-c", String.raw`printf '\033[H\033[2J\033[HREDRAW'; sleep 1`],
      cols: 30,
      rows: 6,
    })
    try {
      await waitUntil(() => session.screenTakeover)
      expect(session.alternateScreen).toBe(false)
      expect(session.screenTakeover).toBe(true)
    } finally {
      session.kill()
    }
  })

  test("DECTCEM 隐藏与恢复子终端光标", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["-c", String.raw`printf '\033[?25lHIDDEN'; sleep 0.2; printf '\033[?25h'; sleep 1`],
      cols: 30,
      rows: 6,
    })
    try {
      await waitUntil(() => !session.cursorVisible)
      expect(session.cursorVisible).toBe(false)
      await waitUntil(() => session.cursorVisible)
      expect(session.cursorVisible).toBe(true)
    } finally {
      session.kill()
    }
  })

  test("normal buffer 暴露内容自然高度并区分尾部光标行", async () => {
    const session = createAntermSession({
      command: "bash",
      args: ["-c", "printf 'one\\ntwo\\n'; sleep 1"],
      cols: 30,
      rows: 8,
    })
    try {
      await waitUntil(() => session.normalOutputRows === 2)
      expect(session.normalContentRows).toBe(3)
      expect(session.normalOutputRows).toBe(2)
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

  test("销毁会抑制迟到的 onExit 回调", async () => {
    let exitCalls = 0
    const session = createAntermSession({
      command: "cat",
      cols: 20,
      rows: 4,
      onExit: () => {
        exitCalls++
      },
    })
    session.kill()
    await waitUntil(() => session.exited)
    expect(exitCalls).toBe(0)
  })
})
