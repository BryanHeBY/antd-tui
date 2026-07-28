/**
 * 终端显示宽度工具（wcwidth 子集）。
 * JS 的 string.length 数的是码元，而 CJK/全角字符在终端占 2 列，
 * 所有做列宽/对齐/截断的组件必须以显示宽度为准，否则中文内容必然错位。
 */

/** 单字符显示宽度：CJK 统一表意/全角/宽标点记 2，其余记 1 */
function charWidth(cp: number): number {
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  return wide ? 2 : 1
}

/** 字符串显示宽度（终端列数） */
export function displayWidth(text: string): number {
  let width = 0
  for (const ch of text) width += charWidth(ch.codePointAt(0)!)
  return width
}

/**
 * 按显示宽度截断到恰好 width 列：超宽时以 … 结尾，
 * 双宽字符切不下时用空格补位，保证返回值显示宽度恒等于 width。
 */
export function truncateToWidth(text: string, width: number): string {
  if (width <= 0) return ""
  if (displayWidth(text) <= width) return text
  const ellipsis = width > 1 ? "…" : ""
  const target = width - ellipsis.length
  let out = ""
  let used = 0
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0)!)
    if (used + w > target) break
    out += ch
    used += w
  }
  return out + ellipsis + " ".repeat(width - used - ellipsis.length)
}
