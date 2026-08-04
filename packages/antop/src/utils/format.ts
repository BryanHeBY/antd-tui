import { displayWidth, truncateToWidth } from "@antd-tui/components"
import type { AntopProcess } from "./types"

export function fit(text: string, width: number, align: "left" | "right" = "left"): string {
  const value = truncateToWidth(text, width)
  const padding = Math.max(0, width - displayWidth(value))
  return align === "right" ? " ".repeat(padding) + value : value + " ".repeat(padding)
}

export function processLabel(proc: AntopProcess, commandWidth: number): string {
  return truncateToWidth(proc.command, commandWidth)
}
