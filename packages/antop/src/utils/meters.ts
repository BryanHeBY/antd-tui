import { fg, StyledText, type TextChunk } from "@opentui/core"

export type MeterSegment = { value: number; color: string }

export const WAVEFORM_CHARS = " ▁▂▃▄▅▆▇█"
export const WAVEFORM_MAX_SAMPLES = 60
export const WAVEFORM_WIDTH = 8
export const WAVEFORM_MEM_WIDTH = 6

export function renderWaveform(history: number[], width: number, color: string, dimColor: string): TextChunk[] {
  const samples = history.slice(-width)
  const padCount = width - samples.length
  const chunks: TextChunk[] = []
  if (padCount > 0) chunks.push(fg(dimColor)(" ".repeat(padCount)))
  for (let i = 0; i < samples.length; i++) {
    const val = samples[i]!
    const charIdx = Math.min(8, Math.floor((val / 100) * 8 + 0.5))
    chunks.push(fg(i === samples.length - 1 ? color : dimColor)(WAVEFORM_CHARS[charIdx]!))
  }
  return chunks
}

export function fallbackCpuMeters(cpuCount: number, totalLoad: number) {
  const active = Math.min(95, Math.max(0, totalLoad))
  return Array.from({ length: cpuCount }, (_, index) => {
    const offset = ((index % 3) - 1) * 4
    const user = Math.max(0, Math.min(90, active * 0.72 + offset))
    const system = Math.max(0, Math.min(20, active * 0.2 - offset / 2))
    const nice = Math.max(0, Math.min(8, active - user - system))
    return { user, system, nice, irq: 0, idle: Math.max(0, 100 - user - system - nice) }
  })
}

export function foldCpuMeters(
  meters: ReturnType<typeof fallbackCpuMeters>,
): { label: string; meter: ReturnType<typeof fallbackCpuMeters>[number] }[] {
  const CPU_FOLD_THRESHOLD = 16
  if (meters.length <= CPU_FOLD_THRESHOLD) {
    return meters.map((meter, index) => ({ label: `CPU${index}`, meter }))
  }
  const groupSize = Math.ceil(meters.length / CPU_FOLD_THRESHOLD)
  return Array.from({ length: Math.ceil(meters.length / groupSize) }, (_, groupIndex) => {
    const group = meters.slice(groupIndex * groupSize, (groupIndex + 1) * groupSize)
    const count = group.length
    const meter = {
      user: group.reduce((sum, m) => sum + m.user, 0) / count,
      nice: group.reduce((sum, m) => sum + m.nice, 0) / count,
      system: group.reduce((sum, m) => sum + m.system, 0) / count,
      irq: group.reduce((sum, m) => sum + m.irq, 0) / count,
      idle: group.reduce((sum, m) => sum + m.idle, 0) / count,
    }
    const start = groupIndex * groupSize
    const end = Math.min((groupIndex + 1) * groupSize, meters.length) - 1
    const label = start === end ? `CPU${start}` : `C${start}-${end}`
    return { label, meter }
  })
}
