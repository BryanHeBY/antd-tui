import { StyledText, fg, type TextChunk } from "@opentui/core"
import type { MeterSegment } from "../utils/meters"

export function MeterBar({ segments, width }: { segments: MeterSegment[]; width: number }) {
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
    <box style={{ width, height: 1, flexShrink: 0, overflow: "hidden" }}>
      <text content={new StyledText(chunks)} />
    </box>
  )
}
