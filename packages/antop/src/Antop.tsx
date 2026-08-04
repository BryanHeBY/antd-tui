import { uptime } from "node:os"
import { useEffect, useMemo, useRef, useState } from "react"
import { TextAttributes, StyledText, fg, type MouseEvent } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import {
  displayWidth,
  Flex,
  Input,
  Modal,
  Typography,
  truncateToWidth,
  useFocusScopeState,
  useToken,
} from "@antd-tui/components"
import type { AntopProcess, AntopProps, ProcessSortKey } from "./types"
import { readAntopSnapshot, percent, formatBytes, formatUptime } from "./snapshot"
import { fit, processLabel } from "./utils/format"
import { WAVEFORM_WIDTH, WAVEFORM_MEM_WIDTH, WAVEFORM_MAX_SAMPLES, renderWaveform, fallbackCpuMeters, foldCpuMeters } from "./utils/meters"
import { MeterBar } from "./components/MeterBar"
import { TopMenuAction } from "./components/TopMenuAction"
import { DetailPanel } from "./components/DetailPanel"

const MIN_COLUMN_WIDTH = 3
const INITIAL_PROCESS_WIDTHS = [8, 10, 2, 6, 6]
const PROCESS_HEADERS = ["PID", "USER", "S", "CPU%", "MEM%", "COMMAND"]
const PROCESS_SORT_KEYS: ProcessSortKey[] = ["pid", "user", "state", "cpu", "memory", "command"]

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

  const [splitDetailPid, setSplitDetailPid] = useState<number | null>(null)
  const [splitLeftWidth, setSplitLeftWidth] = useState(0)
  const splitResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const historyRef = useRef<Map<string, number[]>>(new Map())

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
      .filter((p) => !query || `${p.pid} ${p.user} ${p.command}`.toLowerCase().includes(query))
      .sort((a, b) => {
        const compared =
          sortBy === "pid" || sortBy === "cpu" || sortBy === "memory"
            ? a[sortBy] - b[sortBy]
            : a[sortBy].localeCompare(b[sortBy])
        return sortOrder === "desc" ? -compared : compared
      })
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
  }, [data])

  const listPanelWidth = splitDetailPid && splitLeftWidth > 0 ? splitLeftWidth : terminalWidth
  const coreColumns = terminalWidth >= 90 && foldedCoreMeters.length > 1 ? 2 : 1
  const coreColumnWidth = Math.floor(terminalWidth / coreColumns)
  const coreBarWidthNoWave = Math.max(8, coreColumnWidth - 15)
  const showWaveform = coreBarWidthNoWave >= 28
  const coreBarWidth = showWaveform ? coreBarWidthNoWave - WAVEFORM_WIDTH - 1 : coreBarWidthNoWave
  const summaryBarWidth = Math.max(8, Math.min(14, Math.floor(terminalWidth / 3) - 24))
  const metersPerColumn = Math.ceil(foldedCoreMeters.length / coreColumns)
  const memoryPercent = percent(data.memoryUsed, data.memoryTotal)
  const memoryBuffersPercent = percent(data.memoryBuffers ?? 0, data.memoryTotal)
  const memoryCachePercent = percent(data.memoryCache ?? 0, data.memoryTotal)
  const swapPercent = percent(data.swapUsed ?? 0, data.swapTotal ?? 0)
  const commandWidth = Math.max(12, listPanelWidth - 4 - processWidths.reduce((sum, w) => sum + w, 0) - 5)
  const tableWidths = [...processWidths, commandWidth]

  const selected = data.processes.find((p) => p.pid === selectedPid) ?? processes[0]
  const visibleProcesses = processes.slice(visibleRange.start, visibleRange.end)
  const topSpacer = visibleRange.start
  const bottomSpacer = processes.length - visibleRange.end
  const detailProcess = splitDetailPid != null
    ? (data.processes.find((p) => p.pid === splitDetailPid) ?? null)
    : null

  useKeyboard((key) => {
    if (key.name === "escape" && !confirmOpen && isActiveScope()) {
      if (splitDetailPid != null) {
        setSplitDetailPid(null)
      } else {
        actions?.submit({ selectedPid: selected?.pid, filter, sortBy, sortOrder })
      }
    }
  })

  const handleProcessClick = (proc: AntopProcess) => {
    const now = Date.now()
    const previous = lastRowClick.current
    setSelectedPid(proc.pid)
    if (previous?.pid === proc.pid && now - previous.at <= 350) {
      setSplitDetailPid((cur) => (cur === proc.pid ? null : proc.pid))
      if (splitLeftWidth === 0) setSplitLeftWidth(Math.floor((terminalWidth || 110) * 0.6))
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

  const handleSplitDividerDown = (event: MouseEvent) => {
    splitResizeRef.current = { startX: event.x, startWidth: splitLeftWidth }
    event.stopPropagation()
  }

  const handleSplitDividerDrag = (event: MouseEvent) => {
    const state = splitResizeRef.current
    if (!state) return
    const delta = event.x - state.startX
    const minLeft = 30
    const minRight = 20
    setSplitLeftWidth(Math.max(minLeft, Math.min(terminalWidth - 1 - minRight, state.startWidth + delta)))
  }

  const processCells = (proc: AntopProcess) => [
    fit(String(proc.pid), tableWidths[0]!, "right"),
    fit(proc.user, tableWidths[1]!),
    fit(proc.state, tableWidths[2]!),
    fit(`${proc.cpu.toFixed(1)}%`, tableWidths[3]!, "right"),
    fit(`${proc.memory.toFixed(1)}%`, tableWidths[4]!, "right"),
    processLabel(proc, tableWidths[5]!),
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
    return fit(`${header}${indicator}`, tableWidths[index]!, index === 0 || index === 3 || index === 4 ? "right" : "left")
  })

  return (
    <box style={{ width: "100%", height: "100%", flexDirection: "column", backgroundColor: "#0d0d0d" }}>

      {/* ── 顶部状态栏 ── */}
      <box style={{ height: 1, flexShrink: 0, flexDirection: "row", backgroundColor: "#1a1a1a", overflow: "hidden" }}>
        <TopMenuAction hotkey="r" onActivate={refresh}>刷新</TopMenuAction>
        <text attributes={0} fg={token.colorBorder}> │ </text>
        <TopMenuAction hotkey="p" onActivate={() => setPaused((v) => !v)}>
          {paused ? "继续" : "暂停"}
        </TopMenuAction>
        <text attributes={0} fg={token.colorBorder}> │ </text>
        <TopMenuAction danger disabled={!selected} onActivate={() => setConfirmOpen(true)}>结束</TopMenuAction>
        <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, flexDirection: "row", justifyContent: "center" }}>
          <text attributes={TextAttributes.BOLD} fg={token.colorPrimaryHover}> antop </text>
          <text attributes={0} fg={token.colorTextSecondary}>{data.host}</text>
          {paused && <text attributes={TextAttributes.BOLD} fg={token.colorWarning}> ⏸ PAUSED</text>}
        </box>
        <text attributes={0} fg={token.colorTextSecondary}>
          {`LOAD ${data.load[0].toFixed(2)}  ${formatUptime(uptime())}  ${data.capturedAt.toLocaleTimeString()} `}
        </text>
      </box>

      {/* ── CPU 面板 ── */}
      <box style={{ flexDirection: "row", flexShrink: 0, backgroundColor: "#141414", overflow: "hidden" }}>
        {Array.from({ length: coreColumns }, (_, column) => (
          <box
            key={column}
            style={{ width: coreColumnWidth, flexShrink: 0, flexDirection: "column", overflow: "hidden" }}
          >
            {foldedCoreMeters.slice(column * metersPerColumn, (column + 1) * metersPerColumn).map((item, index) => {
              const globalIndex = column * metersPerColumn + index
              const active = 100 - item.meter.idle
              const activeColor =
                active >= 85 ? token.colorError :
                active >= 50 ? token.colorWarning :
                token.colorTextSecondary
              return (
                <box key={globalIndex} style={{ height: 1, flexShrink: 0, flexDirection: "row", overflow: "hidden" }}>
                  <text attributes={0} fg={token.colorTextSecondary}>{`${fit(item.label, 5, "right")} [`}</text>
                  <MeterBar
                    width={coreBarWidth}
                    segments={[
                      { value: item.meter.nice, color: "#1677ff" },
                      { value: item.meter.user, color: "#52c41a" },
                      { value: item.meter.system, color: "#ff4d4f" },
                      { value: item.meter.irq, color: "#13c2c2" },
                    ]}
                  />
                  <text attributes={0} fg={activeColor}>{`] ${fit(`${active.toFixed(1)}%`, 6, "right")}`}</text>
                  {showWaveform && (
                    <text
                      attributes={0}
                      content={new StyledText([
                        fg(token.colorBorder)(" "),
                        ...renderWaveform(
                          historyRef.current.get(`cpu-${globalIndex}`) ?? [],
                          WAVEFORM_WIDTH, "#52c41a", "#162516",
                        ),
                      ])}
                    />
                  )}
                </box>
              )
            })}
          </box>
        ))}
      </box>

      {/* ── 内存 + Swap 行 ── */}
      <box style={{ height: 1, flexShrink: 0, flexDirection: "row", backgroundColor: "#141414", overflow: "hidden" }}>
        <text attributes={0} fg={token.colorTextSecondary}> MEM [</text>
        <MeterBar
          width={summaryBarWidth}
          segments={[
            { value: memoryPercent, color: "#52c41a" },
            { value: memoryBuffersPercent, color: "#1677ff" },
            { value: memoryCachePercent, color: "#fa8c16" },
          ]}
        />
        <text attributes={0} fg={token.colorTextSecondary}>{`] ${formatBytes(data.memoryUsed)}/${formatBytes(data.memoryTotal)} `}</text>
        <text
          attributes={0}
          content={new StyledText(renderWaveform(historyRef.current.get("mem") ?? [], WAVEFORM_MEM_WIDTH, "#52c41a", "#162516"))}
        />
        <text attributes={0} fg={token.colorTextSecondary}>{"  SWP ["}</text>
        <MeterBar width={summaryBarWidth} segments={[{ value: swapPercent, color: "#a855f7" }]} />
        <text attributes={0} fg={token.colorTextSecondary}>{`] ${formatBytes(data.swapUsed ?? 0)}/${formatBytes(data.swapTotal ?? 0)} `}</text>
        <text
          attributes={0}
          content={new StyledText(renderWaveform(historyRef.current.get("swap") ?? [], WAVEFORM_MEM_WIDTH, "#a855f7", "#1e0a2e"))}
        />
        <text attributes={0} fg={token.colorTextSecondary}>{`  LOAD ${data.load.map((v) => v.toFixed(2)).join(" ")}`}</text>
      </box>

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
          {` ${processes.length}/${data.processes.length}  双击查看详情  Esc ${splitDetailPid ? "关闭详情" : "退出"} `}
        </text>
      </box>

      {/* ── 进程表（表头 + 分屏内容区）── */}
      <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, flexDirection: "column" }}>
        {renderProcessRow(processHeaders, "process-header", { header: true })}
        <text attributes={0} fg={token.colorBorder}>{separatorLine}</text>

        <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, flexDirection: "row" }}>
          {/* 左：虚拟化进程列表 */}
          <scrollbox
            ref={processListRef}
            scrollY
            scrollX={false}
            style={{
              width: splitDetailPid && splitLeftWidth > 0 ? splitLeftWidth : "100%",
              flexShrink: 0,
              minHeight: 0,
            }}
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

          {/* 可拖动分割线 */}
          {splitDetailPid && (
            <box
              style={{ width: 1, flexShrink: 0, backgroundColor: "#252525" }}
              onMouseDown={handleSplitDividerDown}
              onMouseDrag={handleSplitDividerDrag}
              onMouseDragEnd={() => { splitResizeRef.current = null }}
            />
          )}

          {/* 右：详情面板 */}
          {splitDetailPid && detailProcess && (
            <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, overflow: "hidden" }}>
              <DetailPanel
                process={detailProcess}
                allProcesses={data.processes}
                panelWidth={terminalWidth - (splitLeftWidth > 0 ? splitLeftWidth : Math.floor(terminalWidth * 0.6)) - 1}
                onClose={() => setSplitDetailPid(null)}
                onTerminateRequest={(pid) => { setSelectedPid(pid); setConfirmOpen(true) }}
              />
            </box>
          )}
        </box>
      </box>

      {/* ── 结束请求确认 Modal ── */}
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
