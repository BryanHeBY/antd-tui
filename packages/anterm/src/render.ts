import { RGBA, StyledText, TextAttributes, type TextChunk } from "@opentui/core"
import type { AntermCell, AntermScreen } from "./types"

export interface RenderOptions {
  rows: number
  /** 回看偏移，0 = 贴底 */
  scrollOffset: number
  showCursor: boolean
  defaultFg: RGBA
  defaultBg: RGBA
  /** ANSI 0-15 的色板，16 项 */
  palette: RGBA[]
}

/**
 * 同色复用同一 RGBA 实例：run 合并靠引用相等判断，而 RGBA 的构造每次都新建对象。
 * 立方体索引占 0-255，真彩色键从 0x1000000 起，两者不冲突。
 */
const colorCache = new Map<number, RGBA>()

function cubeColor(index: number): RGBA {
  const cached = colorCache.get(index)
  if (cached) return cached
  const rgba = RGBA.fromIndex(index)
  colorCache.set(index, rgba)
  return rgba
}

function resolveColor(
  mode: AntermCell["fgMode"],
  value: number,
  fallback: RGBA,
  palette: RGBA[],
): RGBA {
  if (mode === "default") return fallback
  if (mode === "rgb") {
    const key = 0x1000000 + (value & 0xffffff)
    const cached = colorCache.get(key)
    if (cached) return cached
    const rgba = RGBA.fromInts((value >> 16) & 255, (value >> 8) & 255, value & 255)
    colorCache.set(key, rgba)
    return rgba
  }
  // ANSI 0-15 随色板走；opentui 的索引换算会摊平成 VGA 暗色
  return value < 16 ? (palette[value] ?? fallback) : cubeColor(value)
}

function cellAttributes(cell: AntermCell): number {
  let attrs = TextAttributes.NONE
  if (cell.bold) attrs |= TextAttributes.BOLD
  if (cell.dim) attrs |= TextAttributes.DIM
  if (cell.italic) attrs |= TextAttributes.ITALIC
  if (cell.underline) attrs |= TextAttributes.UNDERLINE
  if (cell.blink) attrs |= TextAttributes.BLINK
  if (cell.inverse) attrs |= TextAttributes.INVERSE
  if (cell.strikethrough) attrs |= TextAttributes.STRIKETHROUGH
  return attrs
}

/**
 * 把 VT 屏幕快照转成每行一个 StyledText。
 *
 * 相邻同色同属性的 cell 合并成一个 chunk，否则 80×24 屏幕每帧要造 1920 个
 * chunk。TextChunk 是普通对象，直接构造字面量比链式 fg()(bg()(...)) 少一圈闭包。
 */
export function screenToRows(screen: AntermScreen, opts: RenderOptions): StyledText[] {
  const cursorVisible = opts.showCursor && opts.scrollOffset === 0
  const out: StyledText[] = []

  for (let y = 0; y < opts.rows; y++) {
    const absoluteY = screen.viewportY - opts.scrollOffset + y
    const chunks: TextChunk[] = []

    let runText = ""
    let runFg: RGBA = opts.defaultFg
    let runBg: RGBA = opts.defaultBg
    let runAttrs = TextAttributes.NONE
    let runOpen = false

    const flush = () => {
      if (!runOpen || runText.length === 0) return
      chunks.push({ __isChunk: true, text: runText, fg: runFg, bg: runBg, attributes: runAttrs })
      runText = ""
    }

    for (let x = 0; x < screen.cols; x++) {
      const cell = screen.getCell(absoluteY, x)
      if (!cell) break
      // 宽字符的尾半格：内容已随首格一起渲染
      if (cell.width === 0) continue

      const fg = resolveColor(cell.fgMode, cell.fg, opts.defaultFg, opts.palette)
      const bg = resolveColor(cell.bgMode, cell.bg, opts.defaultBg, opts.palette)
      let attrs = cellAttributes(cell)
      if (cursorVisible && y === screen.cursorY && x === screen.cursorX) {
        attrs |= TextAttributes.INVERSE
      }

      const text = cell.chars.length === 0 ? " " : cell.chars

      if (runOpen && attrs === runAttrs && fg === runFg && bg === runBg) {
        runText += text
        continue
      }
      flush()
      runFg = fg
      runBg = bg
      runAttrs = attrs
      runText = text
      runOpen = true
    }
    flush()

    out.push(new StyledText(chunks))
  }

  return out
}
