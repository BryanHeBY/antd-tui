import { describe, expect, test } from "bun:test"
import type { AntopProcess, ProcessSortKey } from "../src/types"
import { parseElapsedSeconds } from "../src/utils/format"
import { sortProcesses } from "../src/utils/sort"

const processes: AntopProcess[] = [
  { pid: 2, ppid: 1, user: "zoe", state: "S", cpu: 2, memory: 2, command: "zeta", time: "59:59", ioRead: 20, ioWrite: 200 },
  { pid: 1, ppid: 1, user: "alice", state: "R", cpu: 1, memory: 1, command: "alpha", time: "1:00:00", ioRead: 10, ioWrite: 100 },
  { pid: 3, ppid: 1, user: "mike", state: "D", cpu: 3, memory: 3, command: "middle", time: "1-00:00:00" },
]

describe("antop process sorting", () => {
  test("TIME 按真实时长而不是字符串排序", () => {
    expect(parseElapsedSeconds("59:59")).toBe(3599)
    expect(parseElapsedSeconds("1:00:00")).toBe(3600)
    expect(parseElapsedSeconds("1-00:00:00")).toBe(86400)
    expect(sortProcesses(processes, "time", "desc").map((process) => process.pid)).toEqual([3, 1, 2])
  })

  test("全部表头字段均可正反序排序，缺失 IO 值始终置底", () => {
    const keys: ProcessSortKey[] = ["pid", "user", "state", "cpu", "memory", "time", "ioRead", "ioWrite", "command"]
    for (const key of keys) {
      const ascending = sortProcesses(processes, key, "asc")
      const descending = sortProcesses(processes, key, "desc")
      expect(ascending).toHaveLength(processes.length)
      expect(descending).toHaveLength(processes.length)
    }
    expect(sortProcesses(processes, "ioRead", "asc").at(-1)?.pid).toBe(3)
    expect(sortProcesses(processes, "ioRead", "desc").at(-1)?.pid).toBe(3)
  })
})
