import { describe, expect, test } from "bun:test"
import { Terminal } from "@xterm/headless"
import { RGBA, TextAttributes } from "@opentui/core"
import {
  defaultAnsiPalette,
  screenToRows,
  toAnsiPalette,
  type AntermCell,
  type AntermScreen,
} from "../src/index"

const DEFAULT_FG = RGBA.fromInts(200, 200, 200)
const DEFAULT_BG = RGBA.fromInts(20, 20, 20)
const PALETTE = toAnsiPalette()

/** 复刻 session.ts 的屏幕读接口，避免为了测纯函数去起真进程。 */
function screenOf(vt: Terminal): AntermScreen {
  return {
    get cols() {
      return vt.cols
    },
    get rows() {
      return vt.rows
    },
    get cursorX() {
      return vt.buffer.active.cursorX
    },
    get cursorY() {
      return vt.buffer.active.cursorY
    },
    get cursorAbsoluteY() {
      return vt.buffer.active.baseY + vt.buffer.active.cursorY
    },
    get viewportY() {
      return vt.buffer.active.viewportY
    },
    getCell(absoluteY, x) {
      const line = vt.buffer.active.getLine(absoluteY)
      if (!line) return null
      const raw = line.getCell(x)
      if (!raw) return null
      const cell: AntermCell = {
        chars: raw.getChars(),
        width: raw.getWidth(),
        fg: raw.getFgColor(),
        bg: raw.getBgColor(),
        fgMode: raw.isFgRGB() ? "rgb" : raw.isFgPalette() ? "palette" : "default",
        bgMode: raw.isBgRGB() ? "rgb" : raw.isBgPalette() ? "palette" : "default",
        bold: !!raw.isBold(),
        dim: !!raw.isDim(),
        italic: !!raw.isItalic(),
        underline: !!raw.isUnderline(),
        blink: !!raw.isBlink(),
        inverse: !!raw.isInverse(),
        strikethrough: !!raw.isStrikethrough(),
      }
      return cell
    },
  }
}

async function feed(data: string, cols = 20, rows = 4) {
  const vt = new Terminal({ cols, rows, allowProposedApi: true, scrollback: 100 })
  await new Promise<void>((resolve) => vt.write(data, resolve))
  return vt
}

function render(vt: Terminal, overrides: Partial<Parameters<typeof screenToRows>[1]> = {}) {
  return screenToRows(screenOf(vt), {
    rows: vt.rows,
    scrollOffset: 0,
    showCursor: false,
    defaultFg: DEFAULT_FG,
    defaultBg: DEFAULT_BG,
    palette: PALETTE,
    ...overrides,
  })
}

const textOf = (line: { chunks: { text: string }[] }) => line.chunks.map((c) => c.text).join("")

describe("screenToRows", () => {
  test("行数与内容按视口输出", async () => {
    const vt = await feed("hello\r\nworld")
    const rows = render(vt)
    expect(rows).toHaveLength(4)
    expect(textOf(rows[0]!).trimEnd()).toBe("hello")
    expect(textOf(rows[1]!).trimEnd()).toBe("world")
    expect(textOf(rows[2]!).trim()).toBe("")
  })

  test("同色相邻 cell 合并成一个 chunk", async () => {
    const vt = await feed("\x1b[31mRED\x1b[0m")
    const rows = render(vt)
    // "RED" 一段 + 行尾空白一段
    expect(rows[0]!.chunks).toHaveLength(2)
    expect(rows[0]!.chunks[0]!.text).toBe("RED")
  })

  test("ANSI 0-15 取自传入色板，而非 opentui 的 VGA 暗色", async () => {
    const vt = await feed("\x1b[31mA\x1b[92mB")
    const rows = render(vt)
    const [red, brightGreen] = rows[0]!.chunks
    expect(red!.text).toBe("A")
    expect(red!.fg).toBe(PALETTE[1])
    expect(brightGreen!.text).toBe("B")
    expect(brightGreen!.fg).toBe(PALETTE[10])
    // opentui 的索引换算给的是 #800000，色板给的是 Campbell 的 #c50f1f
    expect(red!.fg!.toInts().slice(0, 3)).toEqual([0xc5, 0x0f, 0x1f])
  })

  test("自定义色板生效", async () => {
    const vt = await feed("\x1b[31mA")
    const custom = toAnsiPalette([...defaultAnsiPalette].map((_, i) => (i === 1 ? "#ff00ff" : "#000000")))
    const rows = render(vt, { palette: custom })
    expect(rows[0]!.chunks[0]!.fg!.toInts().slice(0, 3)).toEqual([255, 0, 255])
  })

  test("256 色立方体走 opentui 换算，真彩色按 RGB 分量还原", async () => {
    const vt = await feed("\x1b[38;5;208mA\x1b[38;2;255;128;0mB")
    const rows = render(vt)
    const [cube, rgb] = rows[0]!.chunks
    expect(cube!.text).toBe("A")
    expect(cube!.fg!.toInts().slice(0, 3)).toEqual([255, 135, 0])
    expect(rgb!.text).toBe("B")
    expect(rgb!.fg!.toInts().slice(0, 3)).toEqual([255, 128, 0])
  })

  test("未着色的 cell 用传入的默认前景色", async () => {
    const vt = await feed("plain")
    const rows = render(vt)
    expect(rows[0]!.chunks[0]!.fg).toBe(DEFAULT_FG)
    expect(rows[0]!.chunks[0]!.bg).toBe(DEFAULT_BG)
  })

  test("加粗 / 下划线保留属性，反色摊平成显式颜色", async () => {
    const vt = await feed("\x1b[1mB\x1b[0m\x1b[4mU\x1b[0m\x1b[7mR\x1b[0m")
    const rows = render(vt)
    const chunks = rows[0]!.chunks
    expect(chunks[0]!.attributes! & TextAttributes.BOLD).toBeGreaterThan(0)
    expect(chunks[1]!.attributes! & TextAttributes.UNDERLINE).toBeGreaterThan(0)
    expect(chunks[2]!.attributes! & TextAttributes.INVERSE).toBe(0)
    expect(chunks[2]!.fg).toBe(DEFAULT_BG)
    expect(chunks[2]!.bg).toBe(DEFAULT_FG)
  })

  test("宽字符只渲染首格，不重复输出尾半格", async () => {
    const vt = await feed("中文ab")
    const rows = render(vt)
    expect(textOf(rows[0]!).trimEnd()).toBe("中文ab")
  })

  test("光标位置直接交换前背景色", async () => {
    const vt = await feed("hi")
    const withCursor = render(vt, { showCursor: true })
    // 光标停在 "hi" 之后的空格上，会单独成段
    const cursorChunk = withCursor[0]!.chunks.find(
      (c) => c.bg === DEFAULT_FG && c.fg === DEFAULT_BG,
    )
    expect(cursorChunk).toBeDefined()
    expect(cursorChunk!.text).toBe(" ")

    const withoutCursor = render(vt, { showCursor: false })
    expect(
      withoutCursor[0]!.chunks.some((c) => c.bg === DEFAULT_FG && c.fg === DEFAULT_BG),
    ).toBe(false)
  })

  test("回看模式下不画光标", async () => {
    const vt = await feed("hi")
    const rows = render(vt, { showCursor: true, scrollOffset: 1 })
    expect(rows.every((r) => r.chunks.every((c) => c.bg !== DEFAULT_FG || c.fg !== DEFAULT_BG))).toBe(
      true,
    )
  })

  test("回看偏移读到历史行", async () => {
    const vt = await feed("L1\r\nL2\r\nL3\r\nL4\r\nL5\r\nL6", 20, 3)
    expect(textOf(render(vt)[0]!).trimEnd()).toBe("L4")
    expect(textOf(render(vt, { scrollOffset: 3 })[0]!).trimEnd()).toBe("L1")
  })

  test("光标定位序列落在正确的行列", async () => {
    const vt = await feed("\x1b[2J\x1b[3;5HHELLO")
    const rows = render(vt)
    expect(textOf(rows[2]!).trimEnd()).toBe("    HELLO")
  })
})
