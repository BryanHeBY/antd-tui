/**
 * antop：原生 React 的现代终端资源监视器。
 *
 * 取 htop 的高密度进程视图、btop 的分区与仪表节奏，并利用 antd-tui 的鼠标能力：
 * 点进程行查看详情、点表头切换排序、从顶部菜单暂停/刷新/发起结束请求、输入框即时过滤。
 * 运行：bun run antop（需要 TTY）。结束请求不会直接 kill 本机进程，而是作为事件回传宿主。
 */
import { cpus, freemem, hostname, loadavg, totalmem, uptime } from "node:os"
import { readFileSync } from "node:fs"
import { useEffect, useMemo, useRef, useState } from "react"
import { TextAttributes, StyledText, bg, type MouseEvent, type TextChunk } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import {
  displayWidth,
  Flex,
  Input,
  Modal,
  Typography,
  truncateToWidth,
  useFocusScopeState,
  useFocusable,
  useToken,
} from "@antd-tui/components"
import type { ExampleActions } from "./host"

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
  /** Linux 可用时拆出 htop 风格的蓝色 buffer 与橙色 cache 段。 */
  memoryBuffers?: number
  memoryCache?: number
  swapTotal?: number
  swapUsed?: number
  /** 按逻辑 CPU 顺序排列；未提供时根据 load 生成稳定的演示值。 */
  cpuMeters?: AntopCpuMeter[]
  processes: AntopProcess[]
}

type ProcessSortKey = "pid" | "user" | "state" | "cpu" | "memory" | "command"

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
    // 首帧用启动至今的比例；后续帧使用两次轮询之间的真实差分。
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
    // args 保留完整命令行；不能用 split(..., 7)，否则带空格的参数会被静默丢弃。
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
  } catch {
    return []
  }
}

/** 导出采样器，既可直接运行，也便于宿主用固定快照做演示或测试。 */
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
        : [
            {
              pid: process.pid,
              ppid: process.ppid,
              user: process.env.USER ?? "current",
              state: "R",
              cpu: 0,
              memory: 0,
              command: process.title || "bun",
            },
          ],
  }
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.min(100, Math.max(0, Math.round((part / total) * 100))) : 0
}

function formatBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3
  return `${gib.toFixed(gib >= 10 ? 0 : 1)} GiB`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`
}

type MeterSegment = { value: number; color: string }

/** 终端条用连续色块而非单色进度条，保留 htop 的可读性。 */
function MeterBar({ segments, width }: { segments: MeterSegment[]; width: number }) {
  const colors = Array<string>(width).fill("#2b2b2b")
  let cursor = 0
  for (const segment of segments) {
    const cells = Math.min(width - cursor, Math.max(0, Math.round((Math.max(0, segment.value) / 100) * width)))
    for (let index = 0; index < cells; index++) colors[cursor + index] = segment.color
    cursor += cells
  }
  const chunks: TextChunk[] = []
  let start = 0
  for (let index = 1; index <= colors.length; index++) {
    if (index !== colors.length && colors[index] === colors[start]) continue
    // 相邻同色格合并成一个 StyledText chunk；整个 meter 由一个 TextRenderable 一次绘制。
    chunks.push(bg(colors[start]!)(" ".repeat(index - start)))
    start = index
  }
  return (
    <box style={{ width, height: 1, flexShrink: 0, overflow: "hidden" }}>
      <text content={new StyledText(chunks)} />
    </box>
  )
}

function fallbackCpuMeters(cpuCount: number, totalLoad: number): AntopCpuMeter[] {
  const active = Math.min(95, Math.max(0, totalLoad))
  return Array.from({ length: cpuCount }, (_, index) => {
    // 固定快照/测试未带采样明细时，仍能展示每核结构，而不是退化成一个总 CPU 条。
    const offset = ((index % 3) - 1) * 4
    const user = Math.max(0, Math.min(90, active * 0.72 + offset))
    const system = Math.max(0, Math.min(20, active * 0.2 - offset / 2))
    const nice = Math.max(0, Math.min(8, active - user - system))
    return { user, system, nice, irq: 0, idle: Math.max(0, 100 - user - system - nice) }
  })
}

/** 示例内部菜单项：保留鼠标、焦点和热键，视觉上属于同一条菜单而非独立色块按钮。 */
function TopMenuAction({
  hotkey,
  children,
  danger = false,
  disabled = false,
  onActivate,
}: {
  hotkey?: string
  children: string
  danger?: boolean
  disabled?: boolean
  onActivate: () => void
}) {
  const token = useToken()
  const { focused, getFocusedKind, isActiveScope, requestFocus } = useFocusable({
    kind: "action",
    disabled,
    onActivate,
  })

  useKeyboard((key) => {
    if (!hotkey || disabled || !isActiveScope() || getFocusedKind() === "input") return
    if (key.sequence === hotkey) onActivate()
  })

  const foreground = disabled
    ? token.colorTextDisabled
    : danger
      ? token.colorError
      : focused
        ? token.colorPrimaryHover
        : token.colorText
  const backgroundColor = focused ? "#303030" : "transparent"
  return (
    <box
      style={{ height: 1, flexShrink: 0, paddingLeft: 1, paddingRight: 1, backgroundColor }}
      onMouseDown={() => {
        if (disabled) return
        requestFocus()
        onActivate()
      }}
    >
      <text attributes={focused ? TextAttributes.BOLD : 0} fg={foreground} bg={backgroundColor}>{children}</text>
    </box>
  )
}

function processLabel(process: AntopProcess, commandWidth: number): string {
  return truncateToWidth(process.command, commandWidth)
}

const MIN_COLUMN_WIDTH = 3
const INITIAL_PROCESS_WIDTHS = [8, 10, 2, 6, 6]
const PROCESS_HEADERS = ["PID", "USER", "S", "CPU%", "MEM%", "COMMAND"]
const PROCESS_SORT_KEYS: ProcessSortKey[] = ["pid", "user", "state", "cpu", "memory", "command"]

function fit(text: string, width: number, align: "left" | "right" = "left"): string {
  const value = truncateToWidth(text, width)
  const padding = Math.max(0, width - displayWidth(value))
  return align === "right" ? " ".repeat(padding) + value : value + " ".repeat(padding)
}

export interface AntopProps {
  actions?: ExampleActions
  /** 提供固定快照时关闭自动采样，适合嵌入演示与测试。 */
  snapshot?: AntopSnapshot
  /** 自动采样间隔；缺省 2 秒。 */
  tuiPollIntervalMs?: number
}

export function Antop({ actions, snapshot, tuiPollIntervalMs = 2000 }: AntopProps) {
  const [data, setData] = useState<AntopSnapshot>(() => snapshot ?? readAntopSnapshot())
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState("")
  const [sortBy, setSortBy] = useState<ProcessSortKey>("cpu")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [selectedPid, setSelectedPid] = useState<number>(() => data.processes[0]?.pid ?? process.pid)
  const [detailPid, setDetailPid] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [processWidths, setProcessWidths] = useState(INITIAL_PROCESS_WIDTHS)
  const lastRowClick = useRef<{ pid: number; at: number } | null>(null)
  const resizeState = useRef<{ index: number; startX: number; widths: number[] } | null>(null)
  const { isActiveScope } = useFocusScopeState()
  const token = useToken()
  const { width: terminalWidth } = useTerminalDimensions()

  const refresh = () => setData(snapshot ?? readAntopSnapshot())

  useEffect(() => {
    if (snapshot || paused) return
    const timer = setInterval(refresh, tuiPollIntervalMs)
    return () => clearInterval(timer)
  }, [snapshot, paused, tuiPollIntervalMs])

  const processes = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return data.processes
      .filter((process) => !query || `${process.pid} ${process.user} ${process.command}`.toLowerCase().includes(query))
      .sort((a, b) => {
        const compared =
          sortBy === "pid" || sortBy === "cpu" || sortBy === "memory"
            ? a[sortBy] - b[sortBy]
            : a[sortBy].localeCompare(b[sortBy])
        return sortOrder === "desc" ? -compared : compared
      })
  }, [data.processes, filter, sortBy, sortOrder])

  // 过滤或刷新后若当前选择已离开结果集，详情随列表收敛到首项，避免“列表看不到、右侧仍在看旧进程”。
  useEffect(() => {
    if (processes.length > 0 && !processes.some((process) => process.pid === selectedPid)) {
      setSelectedPid(processes[0]!.pid)
    }
  }, [processes, selectedPid])

  const selected = data.processes.find((process) => process.pid === selectedPid) ?? processes[0]
  const detail = data.processes.find((process) => process.pid === detailPid) ?? null
  const memoryPercent = percent(data.memoryUsed, data.memoryTotal)
  const coreMeters = data.cpuMeters?.length
    ? data.cpuMeters
    : fallbackCpuMeters(data.cpuCount, percent(data.load[0], Math.max(1, data.cpuCount)))
  const coreColumns = terminalWidth >= 90 && coreMeters.length > 1 ? 2 : 1
  const metersPerColumn = Math.ceil(coreMeters.length / coreColumns)
  const coreBarWidth = Math.max(8, Math.floor(terminalWidth / coreColumns) - 15)
  // 摘要三等分还要容纳 "MEM ["、"] 9.0 GiB/16 GiB" 等文字；
  // 条宽不能只按三分之一计算，否则窄一格时连开边界都会被 flex 裁掉。
  const summaryBarWidth = Math.max(8, Math.min(14, Math.floor(terminalWidth / 3) - 24))
  const memoryBuffersPercent = percent(data.memoryBuffers ?? 0, data.memoryTotal)
  const memoryCachePercent = percent(data.memoryCache ?? 0, data.memoryTotal)
  const swapPercent = percent(data.swapUsed ?? 0, data.swapTotal ?? 0)
  // 固定列配合 5 条竖向分隔线；COMMAND 吃掉剩余宽度，始终不会换行。
  const commandWidth = Math.max(12, terminalWidth - 4 - processWidths.reduce((sum, width) => sum + width, 0) - 5)
  const tableWidths = [...processWidths, commandWidth]

  useKeyboard((key) => {
    if (key.name === "escape" && !confirmOpen && isActiveScope()) {
      actions?.submit({ selectedPid: selected?.pid, filter, sortBy, sortOrder })
    }
  })

  const handleProcessClick = (process: AntopProcess) => {
    const now = Date.now()
    const previous = lastRowClick.current
    setSelectedPid(process.pid)
    // OpenTUI 暂无 double-click 事件；以同一行 350ms 内的两次 mousedown 保留桌面端直觉。
    if (previous?.pid === process.pid && now - previous.at <= 350) setDetailPid(process.pid)
    lastRowClick.current = { pid: process.pid, at: now }
  }

  const toggleSort = (next: ProcessSortKey) => {
    if (next === sortBy) setSortOrder((order) => (order === "desc" ? "asc" : "desc"))
    else {
      setSortBy(next)
      setSortOrder("desc")
    }
  }

  const handleDividerDown = (index: number, event: MouseEvent) => {
    resizeState.current = { index, startX: event.x, widths: [...processWidths] }
    event.stopPropagation()
  }

  const handleDividerDrag = (index: number, event: MouseEvent) => {
    const state = resizeState.current
    if (!state || state.index !== index) return
    const delta = event.x - state.startX
    const widths = [...state.widths]
    if (index < widths.length - 1) {
      const left = Math.max(MIN_COLUMN_WIDTH, state.widths[index]! + delta)
      const right = Math.max(MIN_COLUMN_WIDTH, state.widths[index + 1]! - (left - state.widths[index]!))
      widths[index] = left
      widths[index + 1] = right
    } else {
      const maximum = state.widths[index]! + commandWidth - 12
      widths[index] = Math.min(maximum, Math.max(MIN_COLUMN_WIDTH, state.widths[index]! + delta))
    }
    setProcessWidths(widths)
  }

  const processCells = (process: AntopProcess) => [
    fit(String(process.pid), tableWidths[0]!, "right"),
    fit(process.user, tableWidths[1]!),
    fit(process.state, tableWidths[2]!),
    fit(`${process.cpu.toFixed(1)}%`, tableWidths[3]!, "right"),
    fit(`${process.memory.toFixed(1)}%`, tableWidths[4]!, "right"),
    processLabel(process, tableWidths[5]!),
  ]

  const renderProcessRow = (
    cells: string[],
    key: string,
    options: { process?: AntopProcess; header?: boolean } = {},
  ) => {
    const selectedRow = options.process?.pid === selected?.pid
    const backgroundColor = selectedRow ? "#17365d" : "transparent"
    const colors = options.header
      ? PROCESS_HEADERS.map((_, index) =>
          PROCESS_SORT_KEYS[index] === sortBy ? token.colorPrimaryHover : token.colorTextSecondary,
        )
      : options.process
        ? [
            token.colorTextSecondary,
            token.colorText,
            options.process.state === "R" ? token.colorSuccess : token.colorTextSecondary,
            options.process.cpu >= 50 ? token.colorWarning : token.colorPrimaryHover,
            options.process.memory >= 10 ? token.colorWarning : token.colorText,
            token.colorText,
          ]
        : []
    return (
      <box
        key={key}
        style={{ height: 1, minHeight: 1, flexShrink: 0, flexDirection: "row", backgroundColor, overflow: "hidden" }}
        onMouseDown={options.process ? () => handleProcessClick(options.process!) : undefined}
        onMouseDrag={(event) => {
          const index = resizeState.current?.index
          if (index !== undefined) handleDividerDrag(index, event)
        }}
        onMouseDragEnd={() => {
          resizeState.current = null
        }}
      >
        {cells.flatMap((cell, index) => {
          const content = (
            <box
              key={`cell-${index}`}
              style={{ width: tableWidths[index]!, height: 1, flexShrink: 0, overflow: "hidden", backgroundColor }}
              onMouseDown={options.header ? () => toggleSort(PROCESS_SORT_KEYS[index]!) : undefined}
            >
              <text attributes={options.header || selectedRow ? TextAttributes.BOLD : 0} fg={selectedRow ? "#ffffff" : colors[index]} bg={backgroundColor}>
                {cell}
              </text>
            </box>
          )
          if (index === cells.length - 1) return [content]
          return [
            content,
            <box
              key={`divider-${index}`}
              style={{ width: 1, height: 1, flexShrink: 0, overflow: "hidden", backgroundColor }}
              onMouseDown={(event) => handleDividerDown(index, event)}
              onMouseDrag={(event) => handleDividerDrag(index, event)}
            >
              <text attributes={0} fg={token.colorBorder} bg={backgroundColor}>│</text>
            </box>,
          ]
        })}
      </box>
    )
  }

  return (
    <box style={{ padding: 1, width: "100%", height: "100%", flexDirection: "column", gap: 0 }}>
      <box style={{ height: 1, flexShrink: 0, flexDirection: "row", backgroundColor: "#1f1f1f", overflow: "hidden" }}>
        <box style={{ height: 1, flexShrink: 0, flexDirection: "row", alignItems: "center" }}>
          <TopMenuAction hotkey="r" onActivate={refresh}>r 刷新</TopMenuAction>
          <text attributes={0} fg={token.colorBorder}>·</text>
          <TopMenuAction hotkey="p" onActivate={() => setPaused((value) => !value)}>
            {paused ? "p 继续" : "p 暂停"}
          </TopMenuAction>
          <text attributes={0} fg={token.colorBorder}>·</text>
          <TopMenuAction danger disabled={!selected} onActivate={() => setConfirmOpen(true)}>结束请求</TopMenuAction>
        </box>
        <text attributes={TextAttributes.BOLD} fg={token.colorPrimaryHover}>
          {`  antop  ${data.host}  ${paused ? "PAUSED" : "RUNNING"}`}
        </text>
        <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }} />
        <text attributes={0} fg={token.colorTextSecondary}>
          {` ${formatUptime(uptime())}  ${data.capturedAt.toLocaleTimeString()} `}
        </text>
      </box>

      <box style={{ flexDirection: "row", flexShrink: 0, backgroundColor: "#171717", overflow: "hidden" }}>
        {Array.from({ length: coreColumns }, (_, column) => (
          <box
            key={column}
            style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, flexDirection: "column", overflow: "hidden" }}
          >
            {coreMeters.slice(column * metersPerColumn, (column + 1) * metersPerColumn).map((core, index) => {
              const cpuIndex = column * metersPerColumn + index
              const active = 100 - core.idle
              return (
                <box key={cpuIndex} style={{ height: 1, flexShrink: 0, flexDirection: "row", overflow: "hidden" }}>
                  <text attributes={0} fg={token.colorTextSecondary}>{`${fit(`CPU${cpuIndex}`, 5, "right")} [`}</text>
                  <MeterBar
                    width={coreBarWidth}
                    segments={[
                      { value: core.nice, color: "#1677ff" },
                      { value: core.user, color: "#52c41a" },
                      { value: core.system, color: "#ff4d4f" },
                      { value: core.irq, color: "#13c2c2" },
                    ]}
                  />
                  <text attributes={0} fg={active >= 85 ? token.colorWarning : token.colorTextSecondary}>{`] ${fit(`${active.toFixed(1)}%`, 6, "right")}`}</text>
                </box>
              )
            })}
          </box>
        ))}
      </box>

      <box style={{ height: 1, flexShrink: 0, flexDirection: "row", backgroundColor: "#171717", overflow: "hidden" }}>
        <text attributes={0} fg={token.colorTextSecondary}> MEM [</text>
        <MeterBar
          width={summaryBarWidth}
          segments={[
            { value: memoryPercent, color: "#52c41a" },
            { value: memoryBuffersPercent, color: "#1677ff" },
            { value: memoryCachePercent, color: "#fa8c16" },
          ]}
        />
        <text attributes={0} fg={token.colorTextSecondary}>{`] ${formatBytes(data.memoryUsed)}/${formatBytes(data.memoryTotal)}  SWP [`}</text>
        <MeterBar width={summaryBarWidth} segments={[{ value: swapPercent, color: "#1677ff" }]} />
        <text attributes={0} fg={token.colorTextSecondary}>{`] ${formatBytes(data.swapUsed ?? 0)}/${formatBytes(data.swapTotal ?? 0)}  LOAD ${data.load.map((value) => value.toFixed(2)).join(" ")}`}</text>
      </box>

      <Input
        placeholder="过滤 PID、用户或命令"
        value={filter}
        tuiOnChange={setFilter}
        style={{ width: "100%" }}
      />

      <box style={{ height: 1, flexShrink: 0, backgroundColor: "#171717", overflow: "hidden" }}>
        <text attributes={0} fg={token.colorTextSecondary}>
          {selected
            ? ` 进程 ${processes.length}/${data.processes.length}  ·  PID ${selected.pid}  ${selected.command}  ·  CPU ${selected.cpu.toFixed(1)}%  MEM ${selected.memory.toFixed(1)}%  ·  点击任意表头排序`
            : ` 进程 ${processes.length}/${data.processes.length}  ·  点击任意表头排序`}
        </text>
      </box>
      {renderProcessRow(
        PROCESS_HEADERS.map((header, index) => {
          const indicator = PROCESS_SORT_KEYS[index] === sortBy
            ? sortOrder === "desc" ? "↓" : "↑"
            : ""
          return fit(`${header}${indicator}`, tableWidths[index]!, index === 0 || index === 3 || index === 4 ? "right" : "left")
        }),
        "process-header",
        { header: true },
      )}
      <text attributes={0} fg={token.colorBorder}>{tableWidths.map((width) => "─".repeat(width)).join("┼")}</text>
      <Flex vertical gap={0} tuiScroll flex={1} style={{ minHeight: 0 }}>
        {processes.length > 0 ? (
          processes.map((process) => renderProcessRow(processCells(process), String(process.pid), { process }))
        ) : (
          <text attributes={0} fg={token.colorTextSecondary}>没有匹配的进程</text>
        )}
      </Flex>

      <Modal
        open={detail !== null}
        title="进程详情"
        okText="申请结束"
        cancelText="关闭"
        tuiWidth={64}
        tuiOnCancel={() => setDetailPid(null)}
        tuiOnOk={() => {
          setDetailPid(null)
          setConfirmOpen(true)
        }}
      >
        {detail ? (
          <Flex vertical gap={0}>
            <text attributes={TextAttributes.BOLD} fg={token.colorPrimaryHover}>{detail.command}</text>
            <text attributes={0} fg={token.colorTextSecondary}>{`PID ${detail.pid} · PPID ${detail.ppid} · 用户 ${detail.user} · 状态 ${detail.state}`}</text>
            <text attributes={0} fg={token.colorText}>{`CPU ${detail.cpu.toFixed(1)}%   MEM ${detail.memory.toFixed(1)}%`}</text>
          </Flex>
        ) : null}
      </Modal>

      <Modal
        open={confirmOpen}
        title="发起结束请求"
        okText="回传请求"
        cancelText="取消"
        tuiOnCancel={() => setConfirmOpen(false)}
        tuiOnOk={() => {
          if (selected) actions?.submit({ action: "terminate-request", pid: selected.pid, command: selected.command })
          setConfirmOpen(false)
        }}
      >
        <Typography.Text>确认将结束请求回传给宿主？antop 示例不会直接终止本机进程。</Typography.Text>
      </Modal>
    </box>
  )
}

if (import.meta.main) {
  const { runReactExample } = await import("./host")
  await runReactExample((actions) => <Antop actions={actions} />)
}
