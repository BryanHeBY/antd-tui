import { TextAttributes } from "@opentui/core"
import { Descriptions, Divider, displayWidth, truncateToWidth, useToken } from "@antd-tui/components"
import type { AntopProcess } from "../types"

export function buildProcessTree(proc: AntopProcess, allProcesses: AntopProcess[]): {
  ancestors: AntopProcess[]
  descendants: { proc: AntopProcess; depth: number; isLast: boolean; isLastAtDepth: boolean[] }[]
} {
  const byPid = new Map(allProcesses.map((p) => [p.pid, p]))
  const ancestors: AntopProcess[] = []
  let cur = byPid.get(proc.ppid)
  while (cur && cur.pid !== proc.pid) {
    ancestors.unshift(cur)
    const next = byPid.get(cur.ppid)
    if (!next || next.pid === cur.pid) break
    cur = next
  }

  const descendants: { proc: AntopProcess; depth: number; isLast: boolean; isLastAtDepth: boolean[] }[] = []
  const collectChildren = (parentPid: number, depth: number, isLastAtDepth: boolean[]) => {
    const kids = allProcesses.filter((p) => p.ppid === parentPid && p.pid !== parentPid)
    kids.forEach((kid, i) => {
      const isLast = i === kids.length - 1
      descendants.push({ proc: kid, depth, isLast, isLastAtDepth: [...isLastAtDepth] })
      collectChildren(kid.pid, depth + 1, [...isLastAtDepth, isLast])
    })
  }
  collectChildren(proc.pid, 1, [])

  return { ancestors, descendants }
}

export function DetailPanel({
  process: proc,
  allProcesses,
  panelWidth,
}: {
  process: AntopProcess
  allProcesses: AntopProcess[]
  panelWidth: number
}) {
  const token = useToken()
  const cpuColor = proc.cpu >= 80 ? token.colorError : proc.cpu >= 50 ? token.colorWarning : token.colorSuccess
  const memColor = proc.memory >= 10 ? token.colorWarning : token.colorText
  const stateColor =
    proc.state === "R" ? token.colorSuccess :
    proc.state === "Z" ? token.colorError :
    proc.state === "D" ? token.colorWarning :
    token.colorTextSecondary

  const { ancestors, descendants } = buildProcessTree(proc, allProcesses)
  const treeInnerWidth = Math.max(4, panelWidth - 4)
  const ancestorBase = ancestors.length > 0
    ? "│  ".repeat(ancestors.length - 1) + "   "
    : ""

  return (
    <>
        {/* 基本信息 */}
        <Descriptions
          column={2}
          style={{ flexShrink: 0, marginTop: 1 }}
          items={[
            { label: "PID", children: <b>{String(proc.pid)}</b> },
            { label: "PPID", children: String(proc.ppid) },
            { label: "用户", children: proc.user },
            { label: "状态", children: <span fg={stateColor}><b>{proc.state}</b></span> },
          ]}
        />

        {/* CPU / MEM 指标 */}
        <Divider style={{ flexShrink: 0, marginTop: 1 }} />
        <Descriptions
          column={2}
          style={{ flexShrink: 0 }}
          items={[
            { label: "CPU", children: <span fg={cpuColor}><b>{`${proc.cpu.toFixed(1)}%`}</b></span> },
            { label: "MEM", children: <span fg={memColor}><b>{`${proc.memory.toFixed(1)}%`}</b></span> },
          ]}
        />

        {/* 完整命令行 */}
        <Divider style={{ flexShrink: 0, marginTop: 1 }} />
        <text attributes={0} fg={token.colorTextSecondary} style={{ flexShrink: 0 }}>{"命令行"}</text>
        <text attributes={0} fg={token.colorText} wrapMode="word" style={{ flexShrink: 0 }}>{proc.command}</text>

        {/* 进程树 */}
        <Divider style={{ flexShrink: 0, marginTop: 1 }} />
        <text attributes={0} fg={token.colorTextSecondary} style={{ flexShrink: 0 }}>{"进程树"}</text>
        {ancestors.map((ancestor, i) => {
          const connector = i === ancestors.length - 1 ? "├─ " : "│  "
          const prefix = i === 0 ? "" : "│  ".repeat(Math.max(0, i - 1)) + connector
          const pidStr = String(ancestor.pid)
          const name = ancestor.command.split(" ")[0] ?? ancestor.command
          const full = truncateToWidth(`${prefix}${pidStr} ${name}`, treeInnerWidth)
          return (
            <box key={ancestor.pid} style={{ height: 1, flexShrink: 0 }}>
              <text attributes={0} fg={token.colorTextDisabled}>{full}</text>
            </box>
          )
        })}
        {/* 当前进程（高亮） */}
        {(() => {
          const depth = ancestors.length
          const prefix = depth === 0 ? "" : "│  ".repeat(depth - 1) + "└─ "
          const pidStr = String(proc.pid)
          const name = proc.command.split(" ")[0] ?? proc.command
          const prefixWidth = displayWidth(prefix)
          const available = Math.max(0, treeInnerWidth - prefixWidth)
          const nameWidth = Math.max(0, available - displayWidth(pidStr) - 1)
          return (
            <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
              <text attributes={0} fg={token.colorBorder}>{prefix}</text>
              <text attributes={TextAttributes.BOLD} fg={token.colorPrimaryHover}>{pidStr}</text>
              <text attributes={0} fg={token.colorBorder}>{" "}</text>
              <text attributes={TextAttributes.BOLD} fg={token.colorText}>{truncateToWidth(name, nameWidth)}</text>
            </box>
          )
        })()}
        {descendants.map(({ proc: d, isLast, isLastAtDepth }) => {
          const prefix = ancestorBase + isLastAtDepth.map((last) => last ? "   " : "│  ").join("") + (isLast ? "└─ " : "├─ ")
          const pidStr = String(d.pid)
          const name = d.command.split(" ")[0] ?? d.command
          const full = truncateToWidth(`${prefix}${pidStr} ${name}`, treeInnerWidth)
          return (
            <box key={d.pid} style={{ height: 1, flexShrink: 0 }}>
              <text attributes={0} fg={token.colorTextSecondary}>{full}</text>
            </box>
          )
        })}
      </>
  )
}
