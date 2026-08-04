import { StyledText, fg, TextAttributes } from "@opentui/core"
import { Flex, useToken } from "@antd-tui/components"
import type { AntopDashboardSample } from "../types"

interface MetricPanelProps {
  label: string
  valueStr: string
  history: number[]
  color: string
  dimColor: string
  height: number
  width: number
}

function MetricPanel({ label, valueStr, history, color, dimColor, height, width }: MetricPanelProps) {
  const token = useToken()
  if (height <= 0 || width <= 0) return null

  const headerLine = `─ ${label} ${"─".repeat(Math.max(0, width - label.length - valueStr.length - 6))}${valueStr} ─`
  const waveformWidth = Math.max(1, width - 2)
  const chartLines = height - 1

  const samples = history.slice(-waveformWidth * chartLines)
  const rows = chartLines
  const cols = Math.min(waveformWidth, Math.ceil(samples.length / rows) + waveformWidth)

  return (
    <Flex vertical style={{ height, flexShrink: 0, overflow: "hidden" }}>
      <box style={{ height: 1, flexShrink: 0, flexDirection: "row", overflow: "hidden" }}>
        <text attributes={TextAttributes.BOLD} fg={token.colorTextSecondary}>{headerLine}</text>
      </box>
      {chartLines > 0 && (
        <Flex vertical style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, overflow: "hidden" }}>
          {Array.from({ length: chartLines }, (_, row) => {
            const rowHistory = history.slice(-waveformWidth)
            const threshold = 1 - (row + 1) / chartLines
            const chunks = rowHistory.map((val, i) => {
              const normalized = val / 100
              const charIdx = Math.max(0, Math.min(8, Math.round((normalized - threshold) * chartLines * 8)))
              const char = charIdx > 0 ? "█" : " "
              const isLast = i === rowHistory.length - 1
              return fg(isLast ? color : dimColor)(char)
            })
            const padCount = Math.max(0, waveformWidth - rowHistory.length)
            return (
              <box key={row} style={{ height: 1, flexShrink: 0, overflow: "hidden" }}>
                <text attributes={0} content={new StyledText([
                  ...(padCount > 0 ? [fg(dimColor)(" ".repeat(padCount))] : []),
                  ...chunks,
                ])} />
              </box>
            )
          })}
        </Flex>
      )}
    </Flex>
  )
}

export function DashboardPanel({
  sample,
  historyRef,
  terminalWidth,
  terminalHeight,
}: {
  sample?: AntopDashboardSample
  historyRef: React.RefObject<Map<string, number[]>>
  terminalWidth: number
  terminalHeight: number
}) {
  const token = useToken()

  const metrics: Array<{
    key: string
    label: string
    valueStr: string
    color: string
    dimColor: string
    visible: boolean
  }> = [
    {
      key: "dash-cpu",
      label: "CPU 使用率",
      valueStr: sample ? `${sample.cpuUsage.toFixed(1)}%` : "–",
      color: "#52c41a",
      dimColor: "#162516",
      visible: true,
    },
    {
      key: "dash-freq",
      label: "CPU 频率",
      valueStr: sample?.cpuFreqMhz ? `${sample.cpuFreqMhz} MHz` : "–",
      color: "#1677ff",
      dimColor: "#0a1a2e",
      visible: true,
    },
    {
      key: "dash-temp",
      label: "CPU 温度",
      valueStr: sample?.cpuTempC !== undefined ? `${sample.cpuTempC}°C` : "–",
      color: "#ff4d4f",
      dimColor: "#2e0a0a",
      visible: sample?.cpuTempC !== undefined,
    },
    {
      key: "dash-mem",
      label: "内存使用率",
      valueStr: sample ? `${sample.memUsage.toFixed(1)}%` : "–",
      color: "#fa8c16",
      dimColor: "#2a1800",
      visible: true,
    },
  ]

  const visibleMetrics = metrics.filter((m) => m.visible)
  const panelHeight = visibleMetrics.length > 0
    ? Math.max(3, Math.floor(terminalHeight / visibleMetrics.length))
    : 3

  return (
    <Flex vertical style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0, backgroundColor: "#0d0d0d", overflow: "hidden" }}>
      {visibleMetrics.map((metric, i) => {
        const history = historyRef.current.get(metric.key) ?? []
        const height = i === visibleMetrics.length - 1
          ? terminalHeight - panelHeight * (visibleMetrics.length - 1)
          : panelHeight
        return (
          <MetricPanel
            key={metric.key}
            label={metric.label}
            valueStr={metric.valueStr}
            history={history}
            color={metric.color}
            dimColor={metric.dimColor}
            height={Math.max(2, height)}
            width={terminalWidth}
          />
        )
      })}
    </Flex>
  )
}
