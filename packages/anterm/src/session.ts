import { Terminal } from "@xterm/headless"
import { SGR_SCAN_TAIL, scanSgrMouseMode } from "./mouse"
import type {
  AntermCell,
  AntermScreen,
  AntermSession,
  AntermSessionOptions,
  MouseTrackingMode,
} from "./types"

/** pty 的 data 回调频率远高于终端帧率，逐块通知会打爆 React 的提交次数。 */
const FRAME_INTERVAL_MS = 16

function createScreen(vt: Terminal, buffer: () => typeof vt.buffer.active): AntermScreen {
  const cell: AntermCell = {
    chars: " ",
    width: 1,
    fg: 0,
    bg: 0,
    fgMode: "default",
    bgMode: "default",
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    blink: false,
    inverse: false,
    strikethrough: false,
  }

  return {
    get cols() {
      return vt.cols
    },
    get rows() {
      return vt.rows
    },
    get cursorX() {
      return buffer().cursorX
    },
    get cursorY() {
      return buffer().cursorY
    },
    get cursorAbsoluteY() {
      return buffer().baseY + buffer().cursorY
    },
    get viewportY() {
      return buffer().viewportY
    },
    // 复用同一个 cell 对象：调用方逐格读取后立即消费，不持有引用
    getCell(absoluteY, x) {
      const line = buffer().getLine(absoluteY)
      if (!line) return null
      const raw = line.getCell(x)
      if (!raw) return null
      cell.chars = raw.getChars()
      cell.width = raw.getWidth()
      cell.fg = raw.getFgColor()
      cell.bg = raw.getBgColor()
      cell.fgMode = raw.isFgRGB() ? "rgb" : raw.isFgPalette() ? "palette" : "default"
      cell.bgMode = raw.isBgRGB() ? "rgb" : raw.isBgPalette() ? "palette" : "default"
      cell.bold = !!raw.isBold()
      cell.dim = !!raw.isDim()
      cell.italic = !!raw.isItalic()
      cell.underline = !!raw.isUnderline()
      cell.blink = !!raw.isBlink()
      cell.inverse = !!raw.isInverse()
      cell.strikethrough = !!raw.isStrikethrough()
      return cell
    },
  }
}

function normalOutputRows(vt: Terminal): number {
  const buffer = vt.buffer.normal
  for (let y = buffer.length - 1; y >= 0; y--) {
    if (buffer.getLine(y)?.translateToString(true) !== "") return y + 1
  }
  return 0
}

/**
 * Bun 的 `spawn({ terminal })` 不会给子进程建立控制终端（`ps` 里 TT 为 `?`），
 * 于是 pty 的 ISIG 找不到前台进程组：Ctrl-C 只会回显 `^C`，不产生 SIGINT，
 * 作业控制也不工作。util-linux 的 `setsid --ctty` 会先 setsid 再把 fd 0 设为
 * 控制终端，正好补上这一步。
 *
 * 其他平台没有等价的现成命令，按仓库惯例降级为直接运行：显示与输入照常，
 * 只是 Ctrl-C 等信号键失效。
 */
interface TerminalLaunch {
  cmd: string[]
  isolatedProcessGroup: boolean
}

function resolveLaunch(command: string, args: string[]): TerminalLaunch {
  if (process.platform === "linux") {
    const setsid = Bun.which("setsid")
    if (setsid) return { cmd: [setsid, "--ctty", command, ...args], isolatedProcessGroup: true }
  }
  return { cmd: [command, ...args], isolatedProcessGroup: false }
}

function killTerminalProcess(
  proc: ReturnType<typeof Bun.spawn>,
  isolatedProcessGroup: boolean,
) {
  if (isolatedProcessGroup && proc.pid > 0) {
    try {
      // setsid 后 leader PID 同时是新进程组 ID，销毁终端时不能留下其子作业。
      process.kill(-proc.pid, "SIGKILL")
      return
    } catch {
      // 已退出或不支持组信号时由 Bun 直接终止 leader。
    }
  }
  proc.kill()
}

export function createAntermSession(opts: AntermSessionOptions): AntermSession {
  const vt = new Terminal({
    cols: opts.cols,
    rows: opts.rows,
    scrollback: opts.scrollback ?? 1000,
    allowProposedApi: true,
  })
  const screen = createScreen(vt, () => vt.buffer.active)
  const normalScreen = createScreen(vt, () => vt.buffer.normal)

  const listeners = new Set<() => void>()
  let frameTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let exited = false
  let sgrMouse = false
  let screenTakeover = false
  let cursorVisible = true

  const flush = () => {
    frameTimer = undefined
    if (disposed) return
    for (const listener of listeners) listener()
  }
  const markDirty = () => {
    if (disposed || frameTimer !== undefined) return
    frameTimer = setTimeout(flush, FRAME_INTERVAL_MS)
  }

  const decoder = new TextDecoder()
  // 转义序列可能被 pty 的读缓冲切断，扫描时带上一块的尾巴
  let scanTail = ""

  const pty = new Bun.Terminal({
    cols: opts.cols,
    rows: opts.rows,
    name: "xterm-256color",
    data(_term, chunk) {
      if (disposed) return
      const text = decoder.decode(chunk, { stream: true })
      // vt.modes 只暴露追踪级别，不区分 1006/1015 编码，只能自己盯原始字节
      const tailLength = scanTail.length
      const scan = scanTail + text
      sgrMouse = scanSgrMouseMode(scan, sgrMouse)
      const hasNewScreenErase = Array.from(scan.matchAll(/\x1b\[[23]J/g)).some(
        (match) => (match.index ?? 0) + match[0].length > tailLength,
      )
      const cursorModeMatches = Array.from(scan.matchAll(/\x1b\[\?25([hl])/g)).filter(
        (match) => (match.index ?? 0) + match[0].length > tailLength,
      )
      const lastCursorMode = cursorModeMatches.at(-1)
      if (lastCursorMode) cursorVisible = lastCursorMode[1] === "h"
      scanTail = scan.slice(-SGR_SCAN_TAIL)
      // xterm 的 write 会异步解析；只有回调执行后 buffer 才包含这批输出。
      // 提前通知会让 React 永久渲染旧快照（光标已移动，但命令结果/prompt 仍为空）。
      vt.write(text, () => {
        // less -X 不使用 alternate screen；横向移动时会回首页、清整屏并重画。
        // 只在解析后仍处于 normal buffer 时记 takeover，避免把 vim 在 alternate
        // buffer 内的清屏误认为 normal scrollback 已被破坏。
        if (vt.buffer.active.type === "normal" && hasNewScreenErase) {
          screenTakeover = true
        }
        markDirty()
      })
    },
  })

  const launch = resolveLaunch(opts.command, opts.args ?? [])
  const proc = Bun.spawn({
    cmd: launch.cmd,
    cwd: opts.cwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      ...opts.env,
    },
    terminal: pty,
  })

  // xterm 生成的设备回复（CPR / DA / 焦点上报）必须回写子进程，否则等应答的程序会卡住
  const dataSub = vt.onData((data) => {
    if (!disposed && !exited) pty.write(data)
  })
  const titleSub = vt.onTitleChange((title) => opts.onTitleChange?.(title))
  const bufferSub = vt.buffer.onBufferChange(() => markDirty())

  void proc.exited.then((code) => {
    exited = true
    if (disposed) return
    markDirty()
    opts.onExit?.(code)
  })

  return {
    screen,
    normalScreen,
    write(data) {
      if (!disposed && !exited) pty.write(data)
    },
    resize(cols, rows) {
      if (disposed) return
      if (cols === vt.cols && rows === vt.rows) return
      vt.resize(cols, rows)
      pty.resize(cols, rows)
      markDirty()
    },
    kill() {
      if (disposed) return
      disposed = true
      if (frameTimer !== undefined) clearTimeout(frameTimer)
      listeners.clear()
      dataSub.dispose()
      titleSub.dispose()
      bufferSub.dispose()
      if (!exited) killTerminalProcess(proc, launch.isolatedProcessGroup)
      pty.close()
      vt.dispose()
    },
    onFrame(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    scrollLines(delta) {
      if (disposed) return
      vt.scrollLines(delta)
      markDirty()
    },
    scrollToBottom() {
      if (disposed) return
      vt.scrollToBottom()
      markDirty()
    },
    get exited() {
      return exited
    },
    get alternateScreen() {
      return vt.buffer.active.type === "alternate"
    },
    get screenTakeover() {
      return screenTakeover
    },
    get normalContentRows() {
      const buffer = vt.buffer.normal
      return Math.max(normalOutputRows(vt), buffer.baseY + buffer.cursorY + 1)
    },
    get normalOutputRows() {
      return normalOutputRows(vt)
    },
    get sgrMouse() {
      return sgrMouse
    },
    get cursorVisible() {
      return cursorVisible
    },
    get mouseTracking(): MouseTrackingMode {
      return vt.modes.mouseTrackingMode
    },
    get applicationCursorKeys() {
      return vt.modes.applicationCursorKeysMode
    },
    get bracketedPaste() {
      return vt.modes.bracketedPasteMode
    },
  }
}
