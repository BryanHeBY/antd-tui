/**
 * ansh 的 agent 工具桥：把共享 shell 与命令卡片流暴露成宿主工具。
 *
 * 经 @antd-tui/pi-agent 的双注册面生效——pi 后端进程内直调，ACP 后端经
 * 进程内 MCP 注入外部 agent。工具语义（见各 description）：
 *   ansh_exec    在用户的共享 shell 里跑命令（卡片标 ◆，天然串行，继承实时 cwd/别名/venv）
 *   ansh_history 最近命令清单（退出码/耗时/来源）——排查入口
 *   ansh_output  读某条历史命令的冻结输出（分页，负 offset 从尾部数）
 */
import { Type } from "typebox"
import type { HostToolSpec } from "@antd-tui/pi-agent"
import type { StyledText } from "@opentui/core"
import type { Block, ShellExecResult } from "../types"

/** exec 返回给 agent 的输出上限（行）；全量走 ansh_output 分页 */
const EXEC_TAIL_LINES = 80
const HISTORY_DEFAULT_LIMIT = 20
const OUTPUT_DEFAULT_LIMIT = 200

/** StyledText 行 → 纯文本（样式剥离，宽字符保留） */
function plainLine(line: StyledText): string {
  return line.chunks.map((chunk) => chunk.text).join("")
}

export interface AnshToolDeps {
  /** 共享 shell 的可等待执行（useShellSession.exec） */
  exec: (line: string, options?: { timeoutMs?: number }) => Promise<ShellExecResult>
  /** 当前 cwd（OSC 7 实时上报） */
  cwd: () => string
  /** 命令卡片流（history/output 的数据源） */
  blocks: () => Block[]
}

/** ansh 宿主工具集的具名契约 */
export type AnshShellTools = HostToolSpec<never>[]

export function anshShellTools(deps: AnshToolDeps): AnshShellTools {
  const execSpec: HostToolSpec<{ command: string; timeoutMs?: number }> = {
    name: "ansh_exec",
    description:
      "在用户的长驻交互 shell 里前台执行命令并等待结束。你会自动继承用户的实时 cwd、别名、已 export 的变量与 venv。命令在前台运行、输出实时可见，用户可以在执行期间直接打字与命令交互——因此可以放心启动交互式程序（python3/node REPL、less 等）供用户使用，命令退出后你会拿到完整结果；交互式命令请传 timeoutMs: 0（不限时）。批量/非交互任务用非交互形式并给合理超时（默认 120s，超时不杀命令、改报 running 可经 ansh_output 轮询）。返回 { id, exitCode, output(尾部行) }；全量输出经 ansh_output 按 id 分页读取。",
    parameters: Type.Object({
      command: Type.String({ description: "要执行的完整 shell 命令行" }),
      timeoutMs: Type.Optional(
        Type.Integer({ description: "等待归位的毫秒数；默认 120000；0 = 不限时（交互式命令用）" }),
      ),
    }),
    run: async ({ command, timeoutMs }) => {
      if (command.trim() === "") throw new Error("command 不能为空")
      const result = await deps.exec(command, { timeoutMs })
      if (result.state !== "exited") {
        return { id: result.id, state: result.state, note: result.note ?? "", cwd: deps.cwd() }
      }
      const all = (result.lines ?? []).map(plainLine)
      const tail = all.slice(-EXEC_TAIL_LINES)
      return {
        id: result.id,
        state: "exited",
        exitCode: result.exitCode ?? 0,
        cwd: deps.cwd(),
        output:
          all.length > EXEC_TAIL_LINES
            ? [...tail, `… 另有 ${all.length - EXEC_TAIL_LINES} 行，用 ansh_output 取全量`]
            : tail,
        degraded: result.degraded ?? false,
      }
    },
  }

  const historySpec: HostToolSpec<{ limit?: number }> = {
    name: "ansh_history",
    description:
      "列出最近执行的 shell 命令：{ id, label(整行), cwd, exitCode, state, origin(user|agent), durationMs }。排查问题的第一步——先看这里再决定读哪条命令的完整输出。顶层 cwd 是当前工作目录。",
    parameters: Type.Object({
      limit: Type.Optional(Type.Integer({ description: "最多返回几条，默认 20" })),
    }),
    run: ({ limit }) => {
      const cap = Math.max(1, Math.min(limit ?? HISTORY_DEFAULT_LIMIT, 100))
      const shells = deps
        .blocks()
        .filter((block): block is Extract<Block, { kind: "shell" }> => block.kind === "shell")
        .slice(-cap)
        .map((block) => ({
          id: block.id,
          label: block.label,
          cwd: block.cwd,
          state: block.state,
          exitCode: block.exitCode,
          origin: block.origin ?? "user",
          durationMs: block.durationMs,
        }))
      return { cwd: deps.cwd(), commands: shells }
    },
  }

  const outputSpec: HostToolSpec<{ id: number; offset?: number; limit?: number }> = {
    name: "ansh_output",
    description:
      "读一条历史命令的完整冻结输出（分页）。id 来自 ansh_exec 的返回或 ansh_history。offset 为负数时从尾部数（-50 = 最后 50 行）。运行中的命令返回 state=running，可轮询。",
    parameters: Type.Object({
      id: Type.Integer({ description: "命令卡片 id" }),
      offset: Type.Optional(Type.Integer({ description: "起始行偏移；负数表示从尾部数，默认 0" })),
      limit: Type.Optional(Type.Integer({ description: "最多返回行数，默认 200" })),
    }),
    run: ({ id, offset, limit }) => {
      const block = deps.blocks().find((b): b is Extract<Block, { kind: "shell" }> => b.kind === "shell" && b.id === id)
      if (!block) throw new Error(`找不到命令卡片 #${id}；先用 ansh_history 查可用 id`)
      if (block.state === "running") {
        return { id, state: "running", note: "命令尚未归位，稍后重试" }
      }
      const all = (block.lines ?? []).map(plainLine)
      const rowLimit = Math.max(1, Math.min(limit ?? OUTPUT_DEFAULT_LIMIT, 2000))
      const start = offset !== undefined && offset < 0 ? Math.max(0, all.length + offset) : (offset ?? 0)
      return {
        id,
        state: "exited",
        exitCode: block.exitCode,
        totalLines: all.length,
        offset: start,
        lines: all.slice(start, start + rowLimit),
      }
    },
  }

  return [execSpec, historySpec, outputSpec] as AnshShellTools
}

function resultJson(content: unknown): unknown | null {
  if (!Array.isArray(content)) return null
  for (const block of content) {
    const text = (block as { content?: { type?: string; text?: string } }).content
    if (text?.type === "text" && typeof text.text === "string") {
      try {
        return JSON.parse(text.text)
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * 宿主工具结果 → 工具卡的紧凑摘要行。原始 JSON 只给模型；界面按工具形状定制：
 * exec 一行指向 ◆ 卡片（完整输出就在相邻的 shell 卡里），history/output 是紧凑行 + 截断计数。
 * 非宿主工具或 JSON 不可解析返回 null，宿主回退到通用 toolLines 渲染。
 */
export function summarizeToolResult(
  name: string,
  content: unknown,
): string[] | null {
  const result = resultJson(content)
  if (!result || typeof result !== "object") return null
  // 读类工具是「已可见 UI 状态的镜像」：全部一行，人要看内容就问 agent（它会引用）
  if (name === "ansh_history") {
    const r = result as { cwd?: string; commands?: unknown[] }
    return [`↺ 历史 ${r.commands?.length ?? 0} 条 · cwd ${r.cwd ?? "?"}`]
  }
  if (name === "ansh_output") {
    const r = result as { id?: number; state?: string; note?: string; offset?: number; totalLines?: number; lines?: unknown[] }
    if (r.state === "running") return [`↺ #${r.id} ${r.note ?? "运行中"}`]
    const end = (r.offset ?? 0) + (r.lines?.length ?? 0)
    return [`↺ #${r.id} 输出 · 行 ${(r.offset ?? 0) + 1}-${Math.max(end, 0)}/${r.totalLines ?? 0}`]
  }
  return null
}
