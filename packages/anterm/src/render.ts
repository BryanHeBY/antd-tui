import { RGBA, StyledText, TextAttributes, type TextChunk } from "@opentui/core"
import type { AntermCell, AntermScreen } from "./types"

export interface RenderOptions {
  rows: number
  /** 回看偏移，0 = 贴底 */
  scrollOffset: number
  /** 指定要平铺渲染的 buffer 起始绝对行；省略时按 viewport/scrollOffset 计算。 */
  startY?: number
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
  const cursorVisible = opts.showCursor && (opts.startY !== undefined || opts.scrollOffset === 0)
  const out: StyledText[] = []

  for (let y = 0; y < opts.rows; y++) {
    const absoluteY = (opts.startY ?? screen.viewportY - opts.scrollOffset) + y
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

      let fg = resolveColor(cell.fgMode, cell.fg, opts.defaultFg, opts.palette)
      let bg = resolveColor(cell.bgMode, cell.bg, opts.defaultBg, opts.palette)
      let attrs = cellAttributes(cell)
      // 不把 VT 的 SGR 7 继续作为 INVERSE 属性交给 OpenTUI。less 横向整屏重画时
      // INVERSE run 会频繁移动，外层终端的属性差分可能漏掉 reset，形成散落白块。
      // 直接摊平成显式前/背景色，视觉等价且每个单元格的最终颜色是自包含的。
      if (cell.inverse) {
        ;[fg, bg] = [bg, fg]
      }
      if (cursorVisible && absoluteY === screen.cursorAbsoluteY && x === screen.cursorX) {
        // OpenTUI 的 StyledText chunk 在组件渲染路径不会稳定保留 INVERSE 位；直接交换
        // 前景/背景才能保证空白光标格也实际可见。
        ;[fg, bg] = [bg, fg]
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

export interface TextOptions {
  /** 起始绝对行 */
  startY: number
  /** 取多少行 */
  rows: number
  /** 软换行的续行是否与上一行拼成一行（默认 true，取命令输出时才是原文） */
  joinWrapped?: boolean
}

/**
 * 取一段绝对行区间的纯文本。宿主要把命令输出当数据用（静默命令的回包、复制输出）
 * 时需要它；渲染仍然走 screenToRows，两者对 cell 的读法保持一致。
 */
export function screenToText(screen: AntermScreen, opts: TextOptions): string[] {
  const join = opts.joinWrapped ?? true
  const out: string[] = []
  for (let i = 0; i < opts.rows; i++) {
    const absoluteY = opts.startY + i
    if (absoluteY >= screen.length) break
    let text = ""
    for (let x = 0; x < screen.cols; x++) {
      const cell = screen.getCell(absoluteY, x)
      if (!cell) break
      if (cell.width === 0) continue
      text += cell.chars.length === 0 ? " " : cell.chars
    }
    text = text.replace(/\s+$/, "")
    if (join && i > 0 && screen.isWrapped(absoluteY)) out[out.length - 1] += text
    else out.push(text)
  }
  return out
}
