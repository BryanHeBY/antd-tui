import { cpus, freemem, hostname, loadavg, totalmem } from "node:os"
import { readFileSync } from "node:fs"
import type { AntopCpuMeter, AntopDiskStat, AntopDashboardSample, AntopProcess, AntopSnapshot } from "./types"

let previousCpuTimes: Array<{ user: number; nice: number; system: number; irq: number; idle: number }> | null = null
let previousDiskStats: Map<string, { rSectors: number; wSectors: number; ts: number }> | null = null
let previousProcIo: Map<number, { readBytes: number; writeBytes: number; ts: number }> | null = null

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
    const result = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,user=,state=,pcpu=,pmem=,etime=,args="])
    if (result.exitCode !== 0) return []
    const text = new TextDecoder().decode(result.stdout)
    const now = Date.now()
    const currentProcIo = new Map<number, { readBytes: number; writeBytes: number; ts: number }>()
    const prev = previousProcIo

    const processes = text
      .split("\n")
      .flatMap((line) => {
        const fields = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/)
        if (!fields) return []
        const [, pid, ppid, user, state, cpu, memory, etime, command] = fields
        const pidNum = Number(pid)

        let ioRead: number | undefined
        let ioWrite: number | undefined
        try {
          const ioText = readFileSync(`/proc/${pidNum}/io`, "utf8")
          const rb = Number(ioText.match(/read_bytes:\s*(\d+)/)?.[1] ?? "0")
          const wb = Number(ioText.match(/write_bytes:\s*(\d+)/)?.[1] ?? "0")
          currentProcIo.set(pidNum, { readBytes: rb, writeBytes: wb, ts: now })
          const prevEntry = prev?.get(pidNum)
          if (prevEntry) {
            const elapsed = Math.max(1, (now - prevEntry.ts) / 1000)
            ioRead = Math.max(0, (rb - prevEntry.readBytes) / elapsed)
            ioWrite = Math.max(0, (wb - prevEntry.writeBytes) / elapsed)
          }
        } catch {
          // no permission or no /proc entry
        }

        return [{
          pid: pidNum,
          ppid: Number(ppid),
          user: user ?? "?",
          state: state ?? "?",
          cpu: Number(cpu) || 0,
          memory: Number(memory) || 0,
          command: command ?? "unknown",
          time: etime,
          ioRead,
          ioWrite,
        }]
      })
      .filter((p) => !/(?:^|\/)ps(\s|$)/.test(p.command))

    previousProcIo = currentProcIo
    return processes
  } catch {
    return []
  }
}

function readDiskStats(): AntopDiskStat[] {
  try {
    const now = Date.now()
    const text = readFileSync("/proc/diskstats", "utf8")
    const current = new Map<string, { rSectors: number; wSectors: number; ts: number }>()
    for (const line of text.split("\n")) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 14) continue
      const name = parts[2]!
      // skip partitions: nvmeXnYpZ, sdaN, vdaN; skip loop devices
      if (/p\d+$/.test(name)) continue           // nvme partitions: nvme0n1p1
      if (/^(sd|vd|hd|xvd)[a-z]\d+$/.test(name)) continue  // sda1, vdb2
      if (/^loop\d+$/.test(name)) continue        // loop0..N
      const rSectors = Number(parts[5])
      const wSectors = Number(parts[9])
      current.set(name, { rSectors, wSectors, ts: now })
    }

    const prev = previousDiskStats
    previousDiskStats = current

    return Array.from(current.entries()).map(([name, cur]) => {
      const p = prev?.get(name)
      if (!p) return { name, readBps: 0, writeBps: 0 }
      const elapsed = Math.max(0.001, (now - p.ts) / 1000)
      return {
        name,
        readBps: Math.max(0, (cur.rSectors - p.rSectors) * 512 / elapsed),
        writeBps: Math.max(0, (cur.wSectors - p.wSectors) * 512 / elapsed),
      }
    })
  } catch {
    return []
  }
}

function readDashboardSample(cpuMeters: ReturnType<typeof readCpuMeters>, memResult: ReturnType<typeof readMemoryMeters>): AntopDashboardSample {
  const cpuUsage = cpuMeters.length > 0
    ? cpuMeters.reduce((sum, m) => sum + (100 - m.idle), 0) / cpuMeters.length
    : 0

  let cpuFreqMhz = 0
  try {
    const glob = Bun.spawnSync(["sh", "-c", "cat /sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq 2>/dev/null"])
    const freqText = new TextDecoder().decode(glob.stdout)
    const freqs = freqText.split("\n").flatMap((l) => {
      const n = Number(l.trim())
      return n > 0 ? [n] : []
    })
    if (freqs.length > 0) {
      cpuFreqMhz = Math.round(freqs.reduce((s, v) => s + v, 0) / freqs.length / 1000)
    }
  } catch { /* no cpufreq support */ }

  let cpuTempC: number | undefined
  try {
    const tempText = readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8")
    const raw = Number(tempText.trim())
    if (raw > 0) cpuTempC = Math.round(raw / 1000)
  } catch { /* no thermal sensor */ }

  const memUsage = memResult.total > 0
    ? Math.min(100, Math.max(0, (memResult.used / memResult.total) * 100))
    : 0

  return { cpuUsage, cpuFreqMhz, cpuTempC, memUsage }
}

export function readAntopSnapshot(): AntopSnapshot {
  const memory = readMemoryMeters()
  const cpuMeters = readCpuMeters()
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
    cpuMeters,
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
    diskStats: readDiskStats(),
    dashboardSample: readDashboardSample(cpuMeters, memory),
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
