import { uptime } from "node:os"
import { useEffect, useMemo, useRef, useState } from "react"
import { TextAttributes, StyledText, fg, type MouseEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import {
  Flex,
  Input,
  Modal,
  Typography,
  useFocusScopeState,
  useToken,
} from "@antd-tui/components"
import type { AntopProcess, AntopProps, ProcessSortKey } from "./types"
import { readAntopSnapshot, percent, formatBytes, formatUptime } from "./snapshot"
import { fit, processLabel, formatTime, formatIoBps } from "./utils/format"
import { sortProcesses } from "./utils/sort"
import { WAVEFORM_WIDTH, WAVEFORM_MAX_SAMPLES, renderWaveform, fallbackCpuMeters, foldCpuMeters } from "./utils/meters"
import { MeterBar } from "./components/MeterBar"
import { TopMenuAction } from "./components/TopMenuAction"
import { DetailPanel } from "./components/DetailPanel"
import { DashboardPanel } from "./components/DashboardPanel"

type AntopTab = "cpu" | "io" | "dashboard"

const MIN_COLUMN_WIDTH = 3
const INITIAL_PROCESS_WIDTHS = [8, 10, 2, 6, 6, 9, 6, 6]
const PROCESS_HEADERS = ["PID", "USER", "S", "CPU%", "MEM%", "TIME", "IOR", "IOW", "COMMAND"]
const PROCESS_SORT_KEYS: ProcessSortKey[] = ["pid", "user", "state", "cpu", "memory", "time", "ioRead", "ioWrite", "command"]

export function Antop({ actions, snapshot, tuiPollIntervalMs = 2000 }: AntopProps) {
  const [data, setData] = useState(() => snapshot ?? readAntopSnapshot())
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState("")
  const [sortBy, setSortBy] = useState<ProcessSortKey>("cpu")
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc")
  const [selectedPid, setSelectedPid] = useState<number>(() => data.processes[0]?.pid ?? process.pid)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [processWidths, setProcessWidths] = useState(INITIAL_PROCESS_WIDTHS)
  const lastRowClick = useRef<{ pid: number; at: number } | null>(null)
  const resizeState = useRef<{ index: number; startX: number; widths: number[] } | null>(null)
  const processListRef = useRef<any>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 })
  const [activeTab, setActiveTab] = useState<AntopTab>("cpu")

  const [detailPid, setDetailPid] = useState<number | null>(null)

  const historyRef = useRef<Map<string, number[]>>(new Map())

  const { isActiveScope } = useFocusScopeState()
  const token = useToken()
  const { width: terminalWidth, height: terminalHeight } = useTerminalDimensions()

  const refresh = () => setData(snapshot ?? readAntopSnapshot())

  useEffect(() => {
    if (snapshot || paused) return
    const timer = setInterval(refresh, tuiPollIntervalMs)
    return () => clearInterval(timer)
  }, [snapshot, paused, tuiPollIntervalMs])

  const processes = useMemo(() => {
    const query = filter.trim().toLowerCase()
    const filtered = data.processes
      .filter((p) => !query || `${p.pid} ${p.user} ${p.command}`.toLowerCase().includes(query))
    return sortProcesses(filtered, sortBy, sortOrder)
  }, [data.processes, filter, sortBy, sortOrder])

  useEffect(() => {
    if (processes.length > 0 && !processes.some((p) => p.pid === selectedPid)) {
      setSelectedPid(processes[0]!.pid)
    }
  }, [processes, selectedPid])

  useEffect(() => {
    const buffer = 5
    const update = () => {
      const box = processListRef.current
      if (!box) return
      const viewportHeight = box.viewport?.height ?? 20
      const scrollTop = Math.floor(box.scrollTop ?? 0)
      const start = Math.max(0, scrollTop - buffer)
      const end = Math.min(processes.length, start + viewportHeight + buffer * 2)
      setVisibleRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    update()
    const timer = setInterval(update, 80)
    return () => clearInterval(timer)
  }, [processes.length])

  const coreMeters = data.cpuMeters?.length
    ? data.cpuMeters
    : fallbackCpuMeters(data.cpuCount, percent(data.load[0], Math.max(1, data.cpuCount)))
  const foldedCoreMeters = useMemo(() => foldCpuMeters(coreMeters), [coreMeters])

  useEffect(() => {
    const push = (key: string, val: number) => {
      const arr = historyRef.current.get(key) ?? []
      arr.push(Math.min(100, Math.max(0, val)))
      if (arr.length > WAVEFORM_MAX_SAMPLES) arr.shift()
      historyRef.current.set(key, arr)
    }
    push("mem", percent(data.memoryUsed, data.memoryTotal))
    push("swap", percent(data.swapUsed ?? 0, data.swapTotal ?? 0))
    foldedCoreMeters.forEach((item, i) => push(`cpu-${i}`, Math.round(100 - item.meter.idle)))

    // Dashboard history
    if (data.dashboardSample) {
      push("dash-cpu", data.dashboardSample.cpuUsage)
      push("dash-freq", data.dashboardSample.cpuFreqMhz > 0 ? Math.min(100, (data.dashboardSample.cpuFreqMhz / 5000) * 100) : 0)
      if (data.dashboardSample.cpuTempC !== undefined) {
        push("dash-temp", Math.min(100, (data.dashboardSample.cpuTempC / 100) * 100))
      }
      push("dash-mem", data.dashboardSample.memUsage)
    }

    // Disk IO history — normalize to % of rolling max
    if (data.diskStats) {
      for (const disk of data.diskStats) {
        const rKey = `disk-r-${disk.name}`
        const wKey = `disk-w-${disk.name}`
        const rHistory = historyRef.current.get(rKey) ?? []
        const wHistory = historyRef.current.get(wKey) ?? []
        const maxR = Math.max(10 * 1024 * 1024, ...rHistory.map((v) => v), disk.readBps)
        const maxW = Math.max(10 * 1024 * 1024, ...wHistory.map((v) => v), disk.writeBps)
        push(rKey, (disk.readBps / maxR) * 100)
        push(wKey, (disk.writeBps / maxW) * 100)
      }
    }
  }, [data])

  const listPanelWidth = terminalWidth
  // Flex 自动分配两栏宽度，MeterBar 自测填满 — 无需手算 barWidth
  const labelWidth = 10        // CPU标签/MEM/SWP 对齐
  const valueWidth = 12        // 数值列对齐
  const showWaveform = terminalWidth >= 80
  const ioNameWidth = Math.max(8, ...(data.diskStats ?? []).map((d) => d.name.length))
  const cpuMetersPerCol = Math.ceil(foldedCoreMeters.length / 2)
  const memoryPercent = percent(data.memoryUsed, data.memoryTotal)
  const memoryBuffersPercent = percent(data.memoryBuffers ?? 0, data.memoryTotal)
  const memoryCachePercent = percent(data.memoryCache ?? 0, data.memoryTotal)
  const swapPercent = percent(data.swapUsed ?? 0, data.swapTotal ?? 0)
  const commandWidth = Math.max(12, listPanelWidth - 4 - processWidths.reduce((sum, w) => sum + w, 0) - (processWidths.length * 2 - 1))
  const tableWidths = [...processWidths, commandWidth]

  const selected = data.processes.find((p) => p.pid === selectedPid) ?? processes[0]
  const visibleProcesses = processes.slice(visibleRange.start, visibleRange.end)
  const topSpacer = visibleRange.start
  const bottomSpacer = processes.length - visibleRange.end
  const detailProcess = detailPid != null
    ? (data.processes.find((p) => p.pid === detailPid) ?? null)
    : null

  const dashboardAvailableHeight = Math.max(4, terminalHeight - 1) // minus statusbar

  useKeyboard((key) => {
    if ((key.name === "escape" || key.sequence === "q") && !confirmOpen && isActiveScope()) {
      actions?.submit({ selectedPid: selected?.pid, filter, sortBy, sortOrder })
    }
    if (key.sequence === "1" && isActiveScope()) setActiveTab("cpu")
    if (key.sequence === "2" && isActiveScope()) setActiveTab("io")
    if (key.sequence === "3" && isActiveScope()) setActiveTab("dashboard")
  })

  const handleProcessClick = (proc: AntopProcess) => {
    const now = Date.now()
    const previous = lastRowClick.current
    setSelectedPid(proc.pid)
    if (previous?.pid === proc.pid && now - previous.at <= 350) {
      setDetailPid((cur) => (cur === proc.pid ? null : proc.pid))
      lastRowClick.current = null
    } else {
      lastRowClick.current = { pid: proc.pid, at: now }
    }
  }

  const toggleSort = (next: ProcessSortKey) => {
    if (next === sortBy) setSortOrder((order) => (order === "desc" ? "asc" : "desc"))
    else { setSortBy(next); setSortOrder("desc") }
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

  const processCells = (proc: AntopProcess) => [
    fit(String(proc.pid), tableWidths[0]!, "right"),
    fit(proc.user, tableWidths[1]!),
    fit(proc.state, tableWidths[2]!),
    fit(`${proc.cpu.toFixed(1)}%`, tableWidths[3]!, "right"),
    fit(`${proc.memory.toFixed(1)}%`, tableWidths[4]!, "right"),
    fit(formatTime(proc.time), tableWidths[5]!, "right"),
    fit(formatIoBps(proc.ioRead), tableWidths[6]!, "right"),
    fit(formatIoBps(proc.ioWrite), tableWidths[7]!, "right"),
    processLabel(proc, tableWidths[8]!),
  ]

  const renderProcessRow = (
    cells: string[],
    key: string,
    options: { process?: AntopProcess; header?: boolean } = {},
  ) => {
    const selectedRow = options.process?.pid === selected?.pid
    const backgroundColor = selectedRow ? "#17365d" : "transparent"
    const stateOf = options.process?.state
    const stateColor =
      stateOf === "R" ? token.colorSuccess :
      stateOf === "Z" ? token.colorError :
      stateOf === "D" ? token.colorWarning :
      token.colorTextSecondary
    const colors = options.header
      ? PROCESS_HEADERS.map((_, index) =>
          PROCESS_SORT_KEYS[index] === sortBy ? token.colorPrimaryHover : token.colorTextSecondary,
        )
      : options.process
        ? [
            token.colorTextSecondary,
            token.colorText,
            stateColor,
            options.process.cpu >= 80 ? token.colorError : options.process.cpu >= 50 ? token.colorWarning : token.colorPrimaryHover,
            options.process.memory >= 10 ? token.colorWarning : token.colorText,
            token.colorTextSecondary,
            token.colorTextSecondary,
            token.colorTextSecondary,
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
        onMouseDragEnd={() => { resizeState.current = null }}
      >
        {cells.flatMap((cell, index) => {
          const content = (
            <box
              key={`cell-${index}`}
              style={{ width: tableWidths[index]!, height: 1, flexShrink: 0, overflow: "hidden", backgroundColor }}
              onMouseDown={options.header ? () => toggleSort(PROCESS_SORT_KEYS[index]!) : undefined}
            >
              <text
                attributes={options.header || selectedRow ? TextAttributes.BOLD : 0}
                fg={selectedRow ? "#ffffff" : colors[index]}
                bg={backgroundColor}
              >
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

  const separatorLine = tableWidths.map((w) => "─".repeat(w)).join("┼")
  const processHeaders = PROCESS_HEADERS.map((header, index) => {
    const indicator = PROCESS_SORT_KEYS[index] === sortBy ? (sortOrder === "desc" ? "↓" : "↑") : ""
    const rightAligned = index === 0 || index === 3 || index === 4 || index === 5 || index === 6 || index === 7
    return fit(`${header}${indicator}`, tableWidths[index]!, rightAligned ? "right" : "left")
  })

  return (
    <Flex vertical style={{ width: "100%", height: "100%", backgroundColor: "#0d0d0d" }}>

      {/* ── 顶部状态栏 ── */}
      <box style={{ height: 1, flexShrink: 0, flexDirection: "row", backgroundColor: "#1a1a1a", overflow: "hidden" }}>
        <TopMenuAction hotkey="r" onActivate={refresh}>刷新</TopMenuAction>
        <text attributes={0} fg={token.colorBorder}> │ </text>
        <TopMenuAction hotkey="p" onActivate={() => setPaused((v) => !v)}>
          {paused ? "继续" : "暂停"}
        </TopMenuAction>
        <text attributes={0} fg={token.colorBorder}> │ </text>
        <TopMenuAction danger disabled={!selected} onActivate={() => setConfirmOpen(true)}>结束</TopMenuAction>
        <text attributes={0} fg={token.colorBorder}> │ </text>
        {/* Tab 按钮 */}
        <TopMenuAction hotkey="1" onActivate={() => setActiveTab("cpu")}>
          {activeTab === "cpu" ? "▸CPU" : " CPU"}
        </TopMenuAction>
        <TopMenuAction hotkey="2" onActivate={() => setActiveTab("io")}>
          {activeTab === "io" ? "▸IO" : " IO"}
        </TopMenuAction>
        <TopMenuAction hotkey="3" onActivate={() => setActiveTab("dashboard")}>
          {activeTab === "dashboard" ? "▸看板" : " 看板"}
        </TopMenuAction>
        <text attributes={0} fg={token.colorBorder}> │ </text>
        <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, flexDirection: "row", justifyContent: "center" }}>
          <text attributes={TextAttributes.BOLD} fg={token.colorPrimaryHover}> antop </text>
          <text attributes={0} fg={token.colorTextSecondary}>{data.host}</text>
          {paused && <text attributes={TextAttributes.BOLD} fg={token.colorWarning}> ⏸ PAUSED</text>}
        </box>
        <text attributes={0} fg={token.colorTextSecondary}>
          {`LOAD ${data.load[0].toFixed(2)}  ${formatUptime(uptime())}  ${data.capturedAt.toLocaleTimeString()} `}
        </text>
      </box>

      {/* ── Dashboard Tab：全屏看板 ── */}
      {activeTab === "dashboard" && (
        <DashboardPanel
          sample={data.dashboardSample}
          historyRef={historyRef}
          terminalWidth={terminalWidth}
          terminalHeight={dashboardAvailableHeight}
        />
      )}

      {/* ── CPU / IO Tab：统一两栏面板 ── */}
      {activeTab !== "dashboard" && (
        <>
          {/* 顶部两栏面板（CPU tab = cpu+mem/swp，IO tab = 读/写条）*/}
          <Flex style={{ flexShrink: 0, backgroundColor: "#141414", overflow: "hidden" }}>

            {/* ── 左栏 ── */}
            <Flex vertical flex={1} style={{ overflow: "hidden" }}>
              {activeTab === "cpu" && foldedCoreMeters.slice(0, cpuMetersPerCol).map((item, i) => {
                const active = 100 - item.meter.idle
                const activeColor = active >= 85 ? token.colorError : active >= 50 ? token.colorWarning : token.colorTextSecondary
                return (
                  <Flex key={i} style={{ height: 1, flexShrink: 0, overflow: "hidden" }}>
                    <text attributes={0} fg={token.colorTextSecondary}>{`${fit(item.label, labelWidth, "right")} [`}</text>
                    <MeterBar segments={[
                      { value: item.meter.nice, color: "#1677ff" },
                      { value: item.meter.user, color: "#52c41a" },
                      { value: item.meter.system, color: "#ff4d4f" },
                      { value: item.meter.irq, color: "#13c2c2" },
                    ]} />
                    <text attributes={0} fg={activeColor}>{`] ${fit(`${active.toFixed(1)}%`, valueWidth, "right")}`}</text>
                    {showWaveform && <text attributes={0} content={new StyledText([fg(token.colorBorder)(" "), ...renderWaveform(historyRef.current.get(`cpu-${i}`) ?? [], WAVEFORM_WIDTH, "#52c41a", "#162516")])} />}
                  </Flex>
                )
              })}
              {activeTab === "io" && (data.diskStats ?? []).map((disk) => {
                const maxR = Math.max(10 * 1024 * 1024, disk.readBps) * 1.2
                const rPct = (disk.readBps / maxR) * 100
                const rHistory = historyRef.current.get(`disk-r-${disk.name}`) ?? []
                return (
                  <Flex key={disk.name} style={{ height: 1, flexShrink: 0, overflow: "hidden" }}>
                    <text attributes={0} fg={token.colorText}>{` ${fit(disk.name, ioNameWidth)} R [`}</text>
                    <MeterBar segments={[{ value: rPct, color: "#52c41a" }]} />
                    <text attributes={0} fg={token.colorTextSecondary}>{`] ${fit(`${formatIoBps(disk.readBps)}/s`, valueWidth, "right")}`}</text>
                    {showWaveform && <text attributes={0} content={new StyledText([fg(token.colorBorder)(" "), ...renderWaveform(rHistory, WAVEFORM_WIDTH, "#52c41a", "#162516")])} />}
                  </Flex>
                )
              })}
            </Flex>

            {/* ── 右栏 ── */}
            <Flex vertical flex={1} style={{ overflow: "hidden" }}>
              {activeTab === "cpu" && (
                <>
                  {foldedCoreMeters.slice(cpuMetersPerCol).map((item, i) => {
                    const globalIndex = cpuMetersPerCol + i
                    const active = 100 - item.meter.idle
                    const activeColor = active >= 85 ? token.colorError : active >= 50 ? token.colorWarning : token.colorTextSecondary
                    return (
                      <Flex key={globalIndex} style={{ height: 1, flexShrink: 0, overflow: "hidden" }}>
                        <text attributes={0} fg={token.colorTextSecondary}>{`${fit(item.label, labelWidth, "right")} [`}</text>
                        <MeterBar segments={[
                          { value: item.meter.nice, color: "#1677ff" },
                          { value: item.meter.user, color: "#52c41a" },
                          { value: item.meter.system, color: "#ff4d4f" },
                          { value: item.meter.irq, color: "#13c2c2" },
                        ]} />
                        <text attributes={0} fg={activeColor}>{`] ${fit(`${active.toFixed(1)}%`, valueWidth, "right")}`}</text>
                        {showWaveform && <text attributes={0} content={new StyledText([fg(token.colorBorder)(" "), ...renderWaveform(historyRef.current.get(`cpu-${globalIndex}`) ?? [], WAVEFORM_WIDTH, "#52c41a", "#162516")])} />}
                      </Flex>
                    )
                  })}
                </>
              )}
              {activeTab === "io" && (data.diskStats ?? []).map((disk) => {
                const maxW = Math.max(10 * 1024 * 1024, disk.writeBps) * 1.2
                const wPct = (disk.writeBps / maxW) * 100
                const wHistory = historyRef.current.get(`disk-w-${disk.name}`) ?? []
                return (
                  <Flex key={disk.name} style={{ height: 1, flexShrink: 0, overflow: "hidden" }}>
                    <text attributes={0} fg={token.colorText}>{` ${fit(disk.name, ioNameWidth)} W [`}</text>
                    <MeterBar segments={[{ value: wPct, color: "#fa8c16" }]} />
                    <text attributes={0} fg={token.colorTextSecondary}>{`] ${fit(`${formatIoBps(disk.writeBps)}/s`, valueWidth, "right")}`}</text>
                    {showWaveform && <text attributes={0} content={new StyledText([fg(token.colorBorder)(" "), ...renderWaveform(wHistory, WAVEFORM_WIDTH, "#fa8c16", "#2a1800")])} />}
                  </Flex>
                )
              })}
            </Flex>

          </Flex>

          {/* ── MEM | SWP 行（仅 CPU tab，左右各半）── */}
          {activeTab === "cpu" && (
            <Flex style={{ height: 1, flexShrink: 0, backgroundColor: "#141414", overflow: "hidden" }}>
              {/* 左：MEM */}
              <Flex flex={1} style={{ overflow: "hidden" }}>
                <text attributes={0} fg={token.colorTextSecondary}>{`${fit("MEM", labelWidth, "right")} [`}</text>
                <MeterBar segments={[
                  { value: memoryPercent, color: "#52c41a" },
                  { value: memoryBuffersPercent, color: "#1677ff" },
                  { value: memoryCachePercent, color: "#fa8c16" },
                ]} />
                <text attributes={0} fg={token.colorTextSecondary}>{`] ${fit(`${formatBytes(data.memoryUsed)}/${formatBytes(data.memoryTotal)}`, valueWidth, "right")}`}</text>
                {showWaveform && <text attributes={0} content={new StyledText([fg(token.colorBorder)(" "), ...renderWaveform(historyRef.current.get("mem") ?? [], WAVEFORM_WIDTH, "#52c41a", "#162516")])} />}
              </Flex>
              {/* 右：SWP */}
              <Flex flex={1} style={{ overflow: "hidden" }}>
                <text attributes={0} fg={token.colorTextSecondary}>{`${fit("SWP", labelWidth, "right")} [`}</text>
                <MeterBar segments={[{ value: swapPercent, color: "#a855f7" }]} />
                <text attributes={0} fg={token.colorTextSecondary}>{`] ${fit(`${formatBytes(data.swapUsed ?? 0)}/${formatBytes(data.swapTotal ?? 0)}`, valueWidth, "right")}`}</text>
                {showWaveform && <text attributes={0} content={new StyledText([fg(token.colorBorder)(" "), ...renderWaveform(historyRef.current.get("swap") ?? [], WAVEFORM_WIDTH, "#a855f7", "#1e0a2e")])} />}
              </Flex>
            </Flex>
          )}

          {/* ── IO Tab：过滤栏 + 进程表 ── */}
          {activeTab === "io" && (
            <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, flexDirection: "column" }}>
              <box style={{ height: 1, flexShrink: 0, flexDirection: "row", overflow: "hidden" }}>
                <text attributes={0} fg={token.colorTextDisabled}>{" ⌕ "}</text>
                <Input compact placeholder="过滤 PID / 用户 / 命令" value={filter} tuiOnChange={setFilter} />
                <text attributes={0} fg={token.colorTextSecondary}>
                  {` ${processes.length}/${data.processes.length}  双击查看详情 `}
                </text>
              </box>
              <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, flexDirection: "column" }}>
                {renderProcessRow(processHeaders, "process-header-io", { header: true })}
                <text attributes={0} fg={token.colorBorder}>{separatorLine}</text>
                <scrollbox
                  ref={processListRef}
                  scrollY
                  scrollX={false}
                  style={{ width: "100%", flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }}
                  contentOptions={{ flexDirection: "column", gap: 0, minHeight: "100%", width: "100%" }}
                >
                  {processes.length === 0 ? (
                    <text attributes={0} fg={token.colorTextSecondary}> 没有匹配的进程</text>
                  ) : (
                    <>
                      {topSpacer > 0 && <box style={{ height: topSpacer }} />}
                      {visibleProcesses.map((p) => renderProcessRow(processCells(p), String(p.pid), { process: p }))}
                      {bottomSpacer > 0 && <box style={{ height: bottomSpacer }} />}
                    </>
                  )}
                </scrollbox>
              </box>
            </box>
          )}


          {/* ── CPU Tab：过滤栏 + 进程表 ── */}
          {activeTab === "cpu" && (
            <>
              {/* ── 过滤栏 + 进程计数 ── */}
              <box style={{ height: 1, flexShrink: 0, flexDirection: "row", overflow: "hidden" }}>
                <text attributes={0} fg={token.colorTextDisabled}>{" ⌕ "}</text>
                <Input
                  compact
                  placeholder="过滤 PID / 用户 / 命令"
                  value={filter}
                  tuiOnChange={setFilter}
                />
                <text attributes={0} fg={token.colorTextSecondary}>
                  {` ${processes.length}/${data.processes.length}  双击查看详情  Esc/q 退出 `}
                </text>
              </box>

              {/* ── 进程表 ── */}
              <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, flexDirection: "column" }}>
                {renderProcessRow(processHeaders, "process-header", { header: true })}
                <text attributes={0} fg={token.colorBorder}>{separatorLine}</text>
                <scrollbox
                  ref={processListRef}
                  scrollY
                  scrollX={false}
                  style={{ width: "100%", flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }}
                  contentOptions={{ flexDirection: "column", gap: 0, minHeight: "100%", width: "100%" }}
                >
                  {processes.length === 0 ? (
                    <text attributes={0} fg={token.colorTextSecondary}> 没有匹配的进程</text>
                  ) : (
                    <>
                      {topSpacer > 0 && <box style={{ height: topSpacer }} />}
                      {visibleProcesses.map((p) => renderProcessRow(processCells(p), String(p.pid), { process: p }))}
                      {bottomSpacer > 0 && <box style={{ height: bottomSpacer }} />}
                    </>
                  )}
                </scrollbox>
              </box>
            </>
          )}
        </>
      )}

      {/* ── 终止进程确认 Modal ── */}
      <Modal
        open={confirmOpen}
        title="终止进程"
        okText="确认终止"
        cancelText="取消"
        tuiOnCancel={() => setConfirmOpen(false)}
        tuiOnOk={() => {
          if (selected) actions?.submit({ action: "terminate-request", pid: selected.pid, command: selected.command })
          setConfirmOpen(false)
        }}
      >
        <Typography.Text type="danger">⚠ 即将终止 PID {selected?.pid}（{selected?.command.split(" ")[0] ?? ""}），此操作不可撤销。</Typography.Text>
      </Modal>

      {/* ── 进程详情 Modal ── */}
      <Modal
        open={detailPid != null}
        title={detailProcess ? fit(detailProcess.command.split(" ")[0] ?? detailProcess.command, 60) : "进程详情"}
        okText="终止进程"
        cancelText="关闭窗口"
        tuiWidth={Math.min(100, terminalWidth)}
        tuiOnCancel={() => setDetailPid(null)}
        tuiOnOk={() => {
          if (detailProcess) { setSelectedPid(detailProcess.pid); setConfirmOpen(true) }
        }}
      >
        {detailProcess && (
          <DetailPanel
            process={detailProcess}
            allProcesses={data.processes}
            panelWidth={Math.min(100, terminalWidth) - 4}
          />
        )}
      </Modal>
    </Flex>
  )
}
