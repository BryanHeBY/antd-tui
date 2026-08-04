import { StyledText, fg, type TextChunk } from "@opentui/core"
import { useMeasuredWidth, toBoxStyle, type CssLikeStyle } from "@antd-tui/components"
import type { MeterSegment } from "../utils/meters"

const FALLBACK_WIDTH = 10

export function MeterBar({ segments, style }: { segments: MeterSegment[]; style?: CssLikeStyle }) {
  const { boxRef, width: boxWidth } = useMeasuredWidth()
  const width = boxWidth ?? FALLBACK_WIDTH
  if (width <= 0) return null

  const chunks: TextChunk[] = []
  let cursor = 0
  for (const segment of segments) {
    if (cursor >= width) break
    const cells = Math.min(width - cursor, Math.max(0, Math.round((Math.max(0, segment.value) / 100) * width)))
    if (cells > 0) {
      chunks.push(fg(segment.color)("▮".repeat(cells)))
      cursor += cells
    }
  }
  if (cursor < width) {
    chunks.push(fg("#2b2b2b")(" ".repeat(width - cursor)))
  }

  return (
    <box ref={boxRef} style={{ flexGrow: 1, flexBasis: 0, flexShrink: 0, height: 1, overflow: "hidden", ...toBoxStyle(style) }}>
      <text content={new StyledText(chunks)} />
    </box>
  )
}
