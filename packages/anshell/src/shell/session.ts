import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { ParsedKey } from "@opentui/core"
import {
  createAntermSession,
  encodeKey,
  encodePaste,
  type AntermMark,
  type AntermOscEvent,
  type AntermSession,
} from "@antd-tui/anterm"
import type { ShellDialect } from "./dialect"
import { writeShellRc, type ShellInit } from "./rc"

/** 一条命令开始执行时记下的边界。 */
export interface CommandStart {
  mark: AntermMark | null
  row: number
  col: number
  takeoverSeq: number
}

export interface CommandEnd {
  exitCode: number
  row: number
  col: number
}

export interface ShellSessionEvents {
  /** 首个 133;A：shell 就绪，草稿卡归位 */
  onReady: () => void
  /** 133;C：命令开始执行 */
  onCommandStart: (start: CommandStart) => void
  /** 133;D：命令结束 */
  onCommandEnd: (end: CommandEnd) => void
  /** OSC 7：cwd 变化 */
  onCwd: (cwd: string) => void
  /** shell 进程退出 */
  onExit: (code: number | null) => void
}

export type ShellState = "starting" | "idle" | "inFlight"

export interface ShellSession {
  readonly anterm: AntermSession
  readonly state: ShellState
  readonly cwd: string
  /** 当前在飞命令的起始边界（渲染活动卡片用） */
  readonly activeStart: CommandStart | null
  submit: (line: string) => void
  writeKey: (key: ParsedKey) => void
  writePaste: (text: string) => void
  interrupt: () => void
  eof: () => void
  suspend: () => void
  runHidden: (script: string, opts?: { timeoutMs?: number }) => Promise<string>
  requestSize: (cols: number, rows: number) => void
  kill: () => void
}

export interface ShellSessionOptions {
  path: string
  dialect: ShellDialect
  cwd: string
  cols: number
  rows: number
  init?: ShellInit
  events: ShellSessionEvents
}

const RUN_HIDDEN_TIMEOUT_MS = 1500

/** 解析 `verb;param;…;ansh=<nonce>`；nonce 不符返回 null（嵌套 shell 的标记）。 */
function parse133(data: string, nonce: string): { verb: string; params: string[] } | null {
  const parts = data.split(";")
  if (!parts.some((p) => p === `ansh=${nonce}`)) return null
  return { verb: parts[0] ?? "", params: parts.slice(1) }
}

/** OSC 7 的 `file://host/path` → 本地路径。 */
function cwdFromOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(data)
  if (!m) return null
  try {
    return decodeURIComponent(m[1]!)
  } catch {
    return m[1]!
  }
}

/**
 * 一条长驻交互 shell 的状态机。
 *
 * 把 anterm 的 OSC 事件翻译成 idle / inFlight 状态与命令边界，宿主据此切卡片、
 * 归属键盘、上报 cwd。静默命令（补全、命令名表）经 runHidden 复用同一条 shell，
 * 请求/回包走 runtime 目录里的文件，不碰 PTY 的引号转义。
 */
export function createShellSession(opts: ShellSessionOptions): ShellSession {
  const nonce = randomUUID()
  let anterm: AntermSession | null = null
  let runtimeDir = ""
  let cleanupRc: (() => Promise<void>) | null = null

  let state: ShellState = "starting"
  let cwd = opts.cwd
  let ready = false
  let disposed = false
  let activeStart: CommandStart | null = null
  let hidden = false

  // 尚未就绪 / 在飞时的提交排队；就绪或命令结束后按序冲刷
  const submitQueue: Array<{ line: string; hidden: boolean }> = []
  // 推迟到下一个 D 才生效的 cols（避免 reflow 打乱在飞区间）
  let pendingCols: number | null = null
  // 待决的静默命令：id → resolve
  const hiddenWaiters = new Map<string, (output: string) => void>()

  const writeRaw = (data: string) => {
    if (!disposed && anterm && !anterm.exited) anterm.write(data)
  }

  const flushQueue = () => {
    if (state !== "idle" || submitQueue.length === 0) return
    const next = submitQueue.shift()!
    startSubmit(next.line, next.hidden)
  }

  const startSubmit = (line: string, isHidden: boolean) => {
    state = "inFlight"
    hidden = isHidden
    activeStart = null
    const term = anterm!
    writeRaw(encodePaste(line, term.bracketedPaste) + "\r")
  }

  const submitOrQueue = (line: string, isHidden: boolean) => {
    if (state === "idle") startSubmit(line, isHidden)
    else submitQueue.push({ line, hidden: isHidden })
  }

  const handleOsc = (event: AntermOscEvent) => {
    if (event.ident === 7) {
      const next = cwdFromOsc7(event.data)
      if (next && next !== cwd) {
        cwd = next
        opts.events.onCwd(next)
      }
      return
    }
    if (event.ident !== 133) return
    const parsed = parse133(event.data, nonce)
    if (!parsed) return // 嵌套 shell 的标记，忽略

    if (parsed.verb === "A") {
      state = "idle"
      if (!ready) {
        ready = true
        opts.events.onReady()
      }
      flushQueue()
      return
    }
    if (parsed.verb === "C") {
      if (state !== "inFlight" || activeStart) return
      activeStart = {
        mark: event.createMark(),
        row: event.row,
        col: event.col,
        takeoverSeq: event.screenTakeoverSeq,
      }
      if (!hidden) opts.events.onCommandStart(activeStart)
      return
    }
    if (parsed.verb === "D") {
      if (state !== "inFlight") return
      const exitCode = Number(parsed.params[0] ?? "0") || 0
      const wasHidden = hidden
      state = "idle"
      hidden = false
      const end: CommandEnd = { exitCode, row: event.row, col: event.col }
      if (!wasHidden) opts.events.onCommandEnd(end)
      // D 之后应用被推迟的 cols
      if (pendingCols !== null && anterm) {
        anterm.resize(pendingCols, anterm.screen.rows)
        pendingCols = null
      }
      // 待决的静默命令按提交顺序只有一个在飞，取最早的
      const [id] = hiddenWaiters.keys()
      if (wasHidden && id !== undefined) {
        const resolve = hiddenWaiters.get(id)!
        hiddenWaiters.delete(id)
        void readFile(join(runtimeDir, "res", id), "utf8")
          .then((text) => resolve(text.replace(/\n$/, "")))
          .catch(() => resolve(""))
      }
      flushQueue()
      activeStart = null
      return
    }
  }

  void (async () => {
    const launch = await writeShellRc(opts.path, {
      dialect: opts.dialect,
      nonce,
      init: opts.init ?? "user",
    })
    if (disposed) {
      await launch.cleanup()
      return
    }
    runtimeDir = launch.runtimeDir
    cleanupRc = launch.cleanup
    anterm = createAntermSession({
      command: launch.command,
      args: launch.args,
      cwd: opts.cwd,
      env: launch.env,
      cols: opts.cols,
      rows: opts.rows,
      scrollback: 5000,
      onExit: (code) => opts.events.onExit(code),
    })
    anterm.onOsc(handleOsc)
  })()

  const requireReady = (): AntermSession => {
    if (!anterm) throw new Error("shell 尚未就绪")
    return anterm
  }

  return {
    get anterm() {
      return requireReady()
    },
    get state() {
      return state
    },
    get cwd() {
      return cwd
    },
    get activeStart() {
      return activeStart
    },
    submit(line) {
      submitOrQueue(line, false)
    },
    writeKey(key) {
      const term = anterm
      if (!term) return
      const bytes = encodeKey(key, { applicationCursorKeys: term.applicationCursorKeys })
      if (bytes !== null) writeRaw(bytes)
    },
    writePaste(text) {
      const term = anterm
      if (!term) return
      writeRaw(encodePaste(text, term.bracketedPaste))
    },
    interrupt() {
      writeRaw("\x03")
    },
    eof() {
      writeRaw("\x04")
    },
    suspend() {
      writeRaw("\x1a")
    },
    async runHidden(script, hiddenOpts) {
      const id = randomUUID()
      await writeFile(join(runtimeDir, "req", id), script, "utf8")
      const output = new Promise<string>((resolve, reject) => {
        hiddenWaiters.set(id, resolve)
        setTimeout(() => {
          if (hiddenWaiters.delete(id)) reject(new Error("runHidden 超时"))
        }, hiddenOpts?.timeoutMs ?? RUN_HIDDEN_TIMEOUT_MS)
      })
      // 前导空格：配合 HISTCONTROL/hist_ignore_space 不进历史
      submitOrQueue(` __ansh_reply ${id}`, true)
      return output
    },
    requestSize(cols, rows) {
      const term = anterm
      if (!term) return
      // rows 变化不 reflow，立即；cols 会 reflow，在飞时推迟到下一个 D
      if (cols !== term.screen.cols) {
        if (state !== "inFlight" || term.alternateScreen) term.resize(cols, rows)
        else {
          pendingCols = cols
          term.resize(term.screen.cols, rows)
        }
      } else {
        term.resize(cols, rows)
      }
    },
    kill() {
      disposed = true
      anterm?.kill()
      void cleanupRc?.()
    },
  }
}
