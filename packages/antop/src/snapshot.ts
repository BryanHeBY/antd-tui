import { cpus, freemem, hostname, loadavg, totalmem } from "node:os"
import { readFileSync } from "node:fs"
import type { AntopCpuMeter, AntopProcess, AntopSnapshot } from "./types"

let previousCpuTimes: Array<{ user: number; nice: number; system: number; irq: number; idle: number }> | null = null

function readCpuMeters(): AntopCpuMeter[] {
  const current = cpus().map(({ times }) => ({
    user: times.user,
    nice: times.nice,
    system: times.sys,
    irq: times.irq,
    idle: times.idle,
  }))
  const previous = previousCpuTimes
  previousCpuTimes = current

  return current.map((times, index) => {
    const before = previous?.[index] ?? { user: 0, nice: 0, system: 0, irq: 0, idle: 0 }
    const delta = {
      user: Math.max(0, times.user - before.user),
      nice: Math.max(0, times.nice - before.nice),
      system: Math.max(0, times.system - before.system),
      irq: Math.max(0, times.irq - before.irq),
      idle: Math.max(0, times.idle - before.idle),
    }
    const total = delta.user + delta.nice + delta.system + delta.irq + delta.idle
    if (total === 0) return { user: 0, nice: 0, system: 0, irq: 0, idle: 100 }
    return {
      user: (delta.user / total) * 100,
      nice: (delta.nice / total) * 100,
      system: (delta.system / total) * 100,
      irq: (delta.irq / total) * 100,
      idle: (delta.idle / total) * 100,
    }
  })
}

function readMemoryMeters() {
  try {
    const values = Object.fromEntries(
      readFileSync("/proc/meminfo", "utf8")
        .split("\n")
        .flatMap((line) => {
          const match = line.match(/^(\w+):\s+(\d+)\s+kB$/)
          return match ? [[match[1]!, Number(match[2]!) * 1024]] : []
        }),
    ) as Record<string, number>
    const total = values.MemTotal ?? totalmem()
    const buffers = values.Buffers ?? 0
    const cache = (values.Cached ?? 0) + (values.SReclaimable ?? 0)
    const available = values.MemAvailable ?? Math.max(0, total - freemem())
    return {
      total,
      used: Math.max(0, total - available - buffers - cache),
      buffers,
      cache,
      swapTotal: values.SwapTotal ?? 0,
      swapUsed: Math.max(0, (values.SwapTotal ?? 0) - (values.SwapFree ?? 0)),
    }
  } catch {
    const total = totalmem()
    return { total, used: Math.max(0, total - freemem()), buffers: 0, cache: 0, swapTotal: 0, swapUsed: 0 }
  }
}

function readProcesses(): AntopProcess[] {
  try {
    const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,user=,state=,pcpu=,pmem=,args="])
    if (result.exitCode !== 0) return []
    const text = new TextDecoder().decode(result.stdout)
    return text
      .split("\n")
      .flatMap((line) => {
        const fields = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/)
        if (!fields) return []
        const [, pid, ppid, user, state, cpu, memory, command] = fields
        return [{
          pid: Number(pid),
          ppid: Number(ppid),
          user: user ?? "?",
          state: state ?? "?",
          cpu: Number(cpu) || 0,
          memory: Number(memory) || 0,
          command: command ?? "unknown",
        }]
      })
      .filter((p) => !/(?:^|\/)ps(\s|$)/.test(p.command))
  } catch {
    return []
  }
}

export function readAntopSnapshot(): AntopSnapshot {
  const memory = readMemoryMeters()
  const processes = readProcesses()
  return {
    host: hostname(),
    capturedAt: new Date(),
    cpuCount: cpus().length,
    load: loadavg() as [number, number, number],
    memoryTotal: memory.total,
    memoryUsed: memory.used,
    memoryBuffers: memory.buffers,
    memoryCache: memory.cache,
    swapTotal: memory.swapTotal,
    swapUsed: memory.swapUsed,
    cpuMeters: readCpuMeters(),
    processes:
      processes.length > 0
        ? processes
        : [{
            pid: process.pid,
            ppid: process.ppid,
            user: process.env.USER ?? "current",
            state: "R",
            cpu: 0,
            memory: 0,
            command: process.title || "bun",
          }],
  }
}

export function percent(part: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((part / total) * 100))) : 0
}

export function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3
  return `${gib.toFixed(gib >= 10 ? 0 : 1)}G`
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`
}
