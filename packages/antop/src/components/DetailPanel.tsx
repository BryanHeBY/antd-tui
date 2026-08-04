import { TextAttributes } from "@opentui/core"
import { displayWidth, truncateToWidth, useToken } from "@antd-tui/components"
import type { AntopProcess } from "../types"
import { TopMenuAction } from "./TopMenuAction"

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
  onClose,
  onTerminateRequest,
}: {
  process: AntopProcess
  allProcesses: AntopProcess[]
  panelWidth: number
  onClose: () => void
  onTerminateRequest: (pid: number) => void
}) {
  const token = useToken()
  const sepWidth = Math.max(0, panelWidth - 2)
  const cpuColor = proc.cpu >= 80 ? token.colorError : proc.cpu >= 50 ? token.colorWarning : token.colorSuccess
  const memColor = proc.memory >= 10 ? token.colorWarning : token.colorText
  const stateColor =
    proc.state === "R" ? token.colorSuccess :
    proc.state === "Z" ? token.colorError :
    proc.state === "D" ? token.colorWarning :
    token.colorTextSecondary

  const { ancestors, descendants } = buildProcessTree(proc, allProcesses)
  const treeInnerWidth = Math.max(4, panelWidth - 4)

  return (
    <box style={{ flexDirection: "column", height: "100%", backgroundColor: "#1a2030", paddingLeft: 1, paddingRight: 1, overflow: "hidden" }}>
      {/* 标题行（固定） */}
      <box style={{ height: 1, flexShrink: 0, flexDirection: "row", marginTop: 1 }}>
        <text attributes={TextAttributes.BOLD} fg={token.colorPrimaryHover}>
          {truncateToWidth(proc.command.split(" ")[0] ?? proc.command, panelWidth - 8)}
        </text>
        <box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 }} />
        <TopMenuAction onActivate={onClose}>× 关闭</TopMenuAction>
      </box>
      <text attributes={0} fg={token.colorBorder} style={{ flexShrink: 0 }}>{sepWidth > 0 ? "─".repeat(sepWidth) : ""}</text>

      {/* 可滚动内容区 */}
      <scrollbox
        scrollY
        scrollX={false}
        style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: 0 }}
        contentOptions={{ flexDirection: "column", width: "100%" }}
      >
        {/* 基本信息 */}
        <box style={{ height: 1, flexShrink: 0, flexDirection: "row", marginTop: 1 }}>
          <text attributes={0} fg={token.colorTextSecondary}>{"PID  "}</text>
          <text attributes={TextAttributes.BOLD} fg={token.colorText}>{String(proc.pid)}</text>
          <text attributes={0} fg={token.colorBorder}>{"  │  "}</text>
          <text attributes={0} fg={token.colorTextSecondary}>{"PPID  "}</text>
          <text attributes={0} fg={token.colorText}>{String(proc.ppid)}</text>
        </box>
        <box style={{ height: 1, flexShrink: 0, flexDirection: "row" }}>
          <text attributes={0} fg={token.colorTextSecondary}>{"用户  "}</text>
          <text attributes={0} fg={token.colorText}>{proc.user}</text>
          <text attributes={0} fg={token.colorBorder}>{"  │  "}</text>
          <text attributes={0} fg={token.colorTextSecondary}>{"状态  "}</text>
          <text attributes={TextAttributes.BOLD} fg={stateColor}>{proc.state}</text>
        </box>

        {/* CPU / MEM 指标 */}
        <text attributes={0} fg={token.colorBorder} style={{ flexShrink: 0, marginTop: 1 }}>{sepWidth > 0 ? "─".repeat(sepWidth) : ""}</text>
        <box style={{ height: 1, flexShrink: 0, flexDirection: "row", gap: 0 }}>
          <text attributes={0} fg={token.colorTextSecondary}>{"CPU  "}</text>
          <text attributes={TextAttributes.BOLD} fg={cpuColor}>{`${proc.cpu.toFixed(1)}%`}</text>
          <text attributes={0} fg={token.colorBorder}>{"    │    "}</text>
          <text attributes={0} fg={token.colorTextSecondary}>{"MEM  "}</text>
          <text attributes={TextAttributes.BOLD} fg={memColor}>{`${proc.memory.toFixed(1)}%`}</text>
        </box>

        {/* 完整命令行 */}
        <text attributes={0} fg={token.colorBorder} style={{ flexShrink: 0, marginTop: 1 }}>{sepWidth > 0 ? "─".repeat(sepWidth) : ""}</text>
        <text attributes={0} fg={token.colorTextSecondary} style={{ flexShrink: 0 }}>{"命令行"}</text>
        <text attributes={0} fg={token.colorText} wrapMode="word" style={{ flexShrink: 0 }}>{proc.command}</text>

        {/* 进程树 */}
        <text attributes={0} fg={token.colorBorder} style={{ flexShrink: 0, marginTop: 1 }}>{sepWidth > 0 ? "─".repeat(sepWidth) : ""}</text>
        <text attributes={0} fg={token.colorTextSecondary} style={{ flexShrink: 0 }}>{"进程树"}</text>
        {ancestors.map((ancestor, i) => {
          const connector = i === ancestors.length - 1 ? "├─ " : "│  "
          const prefix = "│  ".repeat(i) + (i > 0 ? connector : "")
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
          const prefix = isLastAtDepth.map((last) => last ? "   " : "│  ").join("") + (isLast ? "└─ " : "├─ ")
          const pidStr = String(d.pid)
          const name = d.command.split(" ")[0] ?? d.command
          const full = truncateToWidth(`${prefix}${pidStr} ${name}`, treeInnerWidth)
          return (
            <box key={d.pid} style={{ height: 1, flexShrink: 0 }}>
              <text attributes={0} fg={token.colorTextSecondary}>{full}</text>
            </box>
          )
        })}
      </scrollbox>

      {/* 操作区（固定） */}
      <text attributes={0} fg={token.colorBorder} style={{ flexShrink: 0 }}>{sepWidth > 0 ? "─".repeat(sepWidth) : ""}</text>
      <box style={{ height: 1, flexShrink: 0, flexDirection: "row", marginBottom: 1 }}>
        <TopMenuAction danger onActivate={() => onTerminateRequest(proc.pid)}>结束请求</TopMenuAction>
      </box>
    </box>
  )
}
