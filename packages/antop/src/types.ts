export interface AntopProcess {
  pid: number
  ppid: number
  user: string
  state: string
  cpu: number
  memory: number
  command: string
}

/** htop 式 CPU 条：各段均为该核心一个采样周期内的百分比。 */
export interface AntopCpuMeter {
  user: number
  nice: number
  system: number
  irq: number
  idle: number
}

export interface AntopSnapshot {
  host: string
  capturedAt: Date
  cpuCount: number
  load: [number, number, number]
  memoryTotal: number
  memoryUsed: number
  memoryBuffers?: number
  memoryCache?: number
  swapTotal?: number
  swapUsed?: number
  cpuMeters?: AntopCpuMeter[]
  processes: AntopProcess[]
}

export type ProcessSortKey = "pid" | "user" | "state" | "cpu" | "memory" | "command"

export interface AntopActions {
  submit: (values: Record<string, unknown>) => void
  cancel: () => void
}

export interface AntopProps {
  actions?: AntopActions
  snapshot?: AntopSnapshot
  tuiPollIntervalMs?: number
}
