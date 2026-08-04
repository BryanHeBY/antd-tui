import { displayWidth, truncateToWidth } from "@antd-tui/components"
import type { AntopProcess } from "../types"

export function fit(text: string, width: number, align: "left" | "right" = "left"): string {
  const value = truncateToWidth(text, width)
  const padding = Math.max(0, width - displayWidth(value))
  return align === "right" ? " ".repeat(padding) + value : value + " ".repeat(padding)
}

export function processLabel(proc: AntopProcess, commandWidth: number): string {
  return truncateToWidth(proc.command, commandWidth)
}

export function formatTime(etime?: string): string {
  if (!etime) return "-"
  // etime formats: [[DD-]HH:]MM:SS
  const match = etime.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!match) return etime
  const [, days, hours, minutes] = match
  const d = days ? Number(days) : 0
  const h = hours ? Number(hours) : 0
  const m = Number(minutes)
  if (d > 0) return `${d}d${String(h).padStart(2, "0")}h`
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  return `${String(m).padStart(2, "0")}m`
}

/** 将 ps etime（[[DD-]HH:]MM:SS）转为秒，供真实时长排序使用。 */
export function parseElapsedSeconds(etime?: string): number | undefined {
  if (!etime) return undefined
  const match = etime.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/)
  if (!match) return undefined
  const [, days, hours, minutes, seconds] = match
  return (
    (days ? Number(days) : 0) * 24 * 60 * 60 +
    (hours ? Number(hours) : 0) * 60 * 60 +
    Number(minutes) * 60 +
    Number(seconds)
  )
}

export function formatIoBps(bps?: number): string {
  if (bps === undefined) return "-"
  if (bps >= 1024 * 1024 * 1024) return `${(bps / (1024 * 1024 * 1024)).toFixed(1)}G`
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)}M`
  if (bps >= 1024) return `${Math.round(bps / 1024)}K`
  return `${Math.round(bps)}B`
}
