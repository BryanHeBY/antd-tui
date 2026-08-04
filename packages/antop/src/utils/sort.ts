import type { AntopProcess, ProcessSortKey } from "../types"
import { parseElapsedSeconds } from "./format"

export type SortOrder = "asc" | "desc"

const numericKeys = new Set<ProcessSortKey>(["pid", "cpu", "memory", "ioRead", "ioWrite"])

function numericValue(process: AntopProcess, key: ProcessSortKey): number | undefined {
  if (key === "time") return parseElapsedSeconds(process.time)
  if (!numericKeys.has(key)) return undefined
  const value = process[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/**
 * 进程表的统一排序规则。数值缺失（例如无权限读取 /proc/<pid>/io）始终排在末尾；
 * TIME 先解析为秒，不能用显示字符串或 ps 原串做字典序比较。
 */
export function compareProcesses(
  a: AntopProcess,
  b: AntopProcess,
  key: ProcessSortKey,
  order: SortOrder,
): number {
  let compared: number
  if (numericKeys.has(key) || key === "time") {
    const av = numericValue(a, key)
    const bv = numericValue(b, key)
    if (av === undefined && bv === undefined) return 0
    if (av === undefined) return 1
    if (bv === undefined) return -1
    compared = av - bv
  } else {
    compared = String(a[key] ?? "").localeCompare(String(b[key] ?? ""))
  }
  return order === "desc" ? -compared : compared
}

export function sortProcesses(
  processes: AntopProcess[],
  key: ProcessSortKey,
  order: SortOrder,
): AntopProcess[] {
  return [...processes].sort((a, b) => compareProcesses(a, b, key, order))
}
