/**
 * 帧序列化：把无头渲染捕获的帧转成三种可外发的形态。
 * - text：纯字符画（宽字符占 1 个 JS 字符、2 个屏幕列，适合文本 diff 与 agent 阅读）
 * - ansi：带 24 位前景/背景色与粗体的转义序列，终端 cat 即可预览
 * - svg：等宽字体网格矢量图，浏览器/IDE 直接查看；宽字符按 2 格占位
 */
import type { CapturedFrame, CapturedSpan } from "@opentui/core"

export type SnapshotFormat = "text" | "ansi" | "svg"

const BOLD_BIT = 1

function rgb(span: CapturedSpan, key: "fg" | "bg"): [number, number, number, number] {
  const [r, g, b, a] = span[key].toInts()
  return [r, g, b, a]
}

export function ansiFrame(frame: CapturedFrame): string {
  const lines: string[] = []
  for (const line of frame.lines) {
    let out = ""
    for (const span of line.spans) {
      const [fr, fg2, fb] = rgb(span, "fg")
      const [br, bg2, bb, ba] = rgb(span, "bg")
      const codes: string[] = [`38;2;${fr};${fg2};${fb}`]
      // 背景透明（alpha 0）时用终端默认背景
      codes.push(ba === 0 ? "49" : `48;2;${br};${bg2};${bb}`)
      if ((span.attributes & BOLD_BIT) !== 0) codes.push("1")
      out += `\x1b[${codes.join(";")}m${span.text}`
    }
    lines.push(out + "\x1b[0m")
  }
  return lines.join("\n") + "\n"
}

const CELL_W = 9
const CELL_H = 18
const FONT_SIZE = 14
const BASELINE = 13

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function svgFrame(frame: CapturedFrame): string {
  const width = frame.cols * CELL_W
  const height = frame.rows * CELL_H
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#141414"/>`,
    `<g font-family="'JetBrains Mono','Cascadia Mono',Menlo,Consolas,monospace" font-size="${FONT_SIZE}">`,
  ]
  frame.lines.forEach((line, row) => {
    let col = 0
    for (const span of line.spans) {
      const x = col * CELL_W
      const y = row * CELL_H
      const [br, bg2, bb, ba] = rgb(span, "bg")
      if (ba !== 0) {
        parts.push(
          `<rect x="${x}" y="${y}" width="${span.width * CELL_W}" height="${CELL_H}" fill="rgb(${br},${bg2},${bb})"/>`,
        )
      }
      if (span.text.trim() !== "") {
        const [fr, fg2, fb] = rgb(span, "fg")
        const bold = (span.attributes & BOLD_BIT) !== 0 ? ` font-weight="bold"` : ""
        // textLength 强制拉齐到网格宽度，宽字符（占 2 格）不破坏对齐
        parts.push(
          `<text x="${x}" y="${y + BASELINE}" fill="rgb(${fr},${fg2},${fb})"${bold} xml:space="preserve" textLength="${span.width * CELL_W}" lengthAdjust="spacingAndGlyphs">${escapeXml(span.text)}</text>`,
        )
      }
      col += span.width
    }
  })
  parts.push("</g></svg>")
  return parts.join("\n") + "\n"
}
