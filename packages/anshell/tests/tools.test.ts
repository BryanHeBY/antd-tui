import { describe, expect, test } from "bun:test"
import { StyledText, type TextChunk } from "@opentui/core"
import { anshShellTools, summarizeToolResult, type AnshShellTools } from "../src/agent/tools"
import type { Block, ShellExecResult } from "../src/types"

/** 桥接单测：纯数据驱动 exec/history/output 的加工逻辑。
 * exec 的真 PTY 闭路由 agent E2E（faux 驱动 ansh_exec）覆盖。 */
function line(text: string): StyledText {
  const chunk: TextChunk = { __isChunk: true, text }
  return new StyledText([chunk])
}

interface ToolHandle {
  run: (input: Record<string, unknown>) => Promise<unknown> | unknown
}

function find(tools: AnshShellTools, name: string): ToolHandle {
  const tool = tools.find((t) => t.name === name)
  if (!tool) throw new Error(`missing tool ${name}`)
  return tool as unknown as ToolHandle
}

describe("ansh 工具桥", () => {
  const blocks: Block[] = []

  test("exec 尾部截断 + 截断标记；空命令报错", async () => {
    const tools = anshShellTools({
      exec: async () =>
        ({ id: 1, state: "exited", exitCode: 0, lines: Array.from({ length: 100 }, (_, i) => line(`line-${i}`)) }) as never,
      cwd: () => "/home/hby/dev/antd-tui",
      blocks: () => blocks,
    })
    const result = (await find(tools, "ansh_exec").run({ command: "yes" })) as {
      output: string[]
      exitCode: number
      cwd: string
    }
    expect(result.output.length).toBe(81)
    expect(result.output.at(-1)).toContain("另有 20 行")
    expect(result.output[0]).toBe("line-20")
    expect(result.cwd).toBe("/home/hby/dev/antd-tui")

    await expect(find(tools, "ansh_exec").run({ command: "  " })).rejects.toThrow("不能为空")
  })

  test("exec 超时返回 running 态与提示，不抛错", async () => {
    const tools = anshShellTools({
      exec: async () => ({ id: 2, state: "running", note: "超时未归位（>10ms）" }) as ShellExecResult,
      cwd: () => "/",
      blocks: () => blocks,
    })
    const result = (await find(tools, "ansh_exec").run({ command: "sleep 5", timeoutMs: 10 })) as {
      state: string
      note: string
    }
    expect(result.state).toBe("running")
    expect(result.note).toContain("超时")
  })

  test("history 只取 shell 块并带 origin/durationMs；output 支持 id 查询与负 offset", async () => {
    blocks.length = 0
    blocks.push(
      {
        id: 1,
        kind: "shell",
        label: "echo user-cmd",
        cwd: "/tmp",
        state: "exited",
        exitCode: 0,
        origin: "user",
        startedAt: Date.now() - 50,
        durationMs: 50,
        requestedOverlay: false,
        lines: [line("user-cmd")],
      },
      {
        id: 2,
        kind: "shell",
        label: "echo agent-cmd",
        cwd: "/tmp",
        state: "exited",
        exitCode: 1,
        origin: "agent",
        startedAt: Date.now() - 30,
        durationMs: 30,
        requestedOverlay: false,
        lines: Array.from({ length: 10 }, (_, i) => line(`row-${i}`)),
      },
      { id: 3, kind: "prompt", text: "闲聊", cwd: "/tmp" },
    )

    const tools = anshShellTools({
      exec: async () => ({ id: 0, state: "running" }) as never,
      cwd: () => "/home/hby/dev/antd-tui",
      blocks: () => blocks,
    })
    const history = (await find(tools, "ansh_history").run({})) as {
      cwd: string
      commands: Array<{ id: number; origin: string; exitCode?: number; durationMs?: number }>
    }
    expect(history.cwd).toBe("/home/hby/dev/antd-tui")
    expect(history.commands.map((c) => c.id)).toEqual([1, 2])
    expect(history.commands[1]).toMatchObject({ origin: "agent", exitCode: 1, durationMs: 30 })

    const tail = (await find(tools, "ansh_output").run({ id: 2, offset: -3 })) as {
      lines: string[]
      totalLines: number
      offset: number
    }
    expect(tail.lines).toEqual(["row-7", "row-8", "row-9"])
    expect(tail.offset).toBe(7)
    expect(tail.totalLines).toBe(10)
    expect(() => find(tools, "ansh_output").run({ id: 99 })).toThrow("找不到命令卡片")
  })
})

describe("summarizeToolResult", () => {
  const content = (value: unknown) => [{ type: "content", content: { type: "text", text: JSON.stringify(value) } }]

  test("ansh_exec 不再有摘要（工具卡整卡取消，◆ 卡即记录）", () => {
    expect(summarizeToolResult("ansh_exec", content({ id: 12, state: "exited", exitCode: 0 }))).toBeNull()
  })

  test("ansh_history 压成一行：条数 + cwd", () => {
    const commands = Array.from({ length: 10 }, (_, i) => ({ id: i, label: `cmd-${i}` }))
    expect(summarizeToolResult("ansh_history", content({ cwd: "/w", commands }))).toEqual([
      "↺ 历史 10 条 · cwd /w",
    ])
  })

  test("ansh_output 压成一行：id + 行区间；running 带说明；非宿主与非 JSON 返回 null", () => {
    expect(
      summarizeToolResult(
        "ansh_output",
        content({ id: 5, state: "exited", offset: 2, totalLines: 30, lines: ["a", "b", "c", "d", "e", "f", "g", "h"] }),
      ),
    ).toEqual(["↺ #5 输出 · 行 3-10/30"])
    expect(summarizeToolResult("ansh_output", content({ id: 5, state: "running", note: "命令尚未归位" }))).toEqual([
      "↺ #5 命令尚未归位",
    ])

    expect(summarizeToolResult("bash", content({ x: 1 }))).toBeNull()
    expect(summarizeToolResult("ansh_history", [{ type: "content", content: { type: "text", text: "不是json" } }])).toBeNull()
  })
})
