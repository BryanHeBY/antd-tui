/**
 * pi 原生后端的 slash 命令：不依赖 ACP 会话方法，直接操作进程内 Agent 的
 * 运行时状态。ansh 接进斜杠菜单（与其他本地命令合流），vibe-tui 在输入框
 * 提交前拦截。两个宿主共享同一份命令表与执行逻辑。
 */
import type { PiAgent, PiEffort } from "./index"
import { PI_EFFORTS } from "./pi-config"

export interface NativeCommandSpec {
  name: string
  description: string
  hint?: string
}

export const PI_NATIVE_COMMANDS: readonly NativeCommandSpec[] = [
  {
    name: "model",
    description: "模型：无参列出可用模型并标出当前项，带 provider/model 运行时切换",
    hint: "[provider/model]",
  },
  {
    name: "effort",
    description: "推理力度：无参显示当前值，带值切换（下一轮生效）",
    hint: PI_EFFORTS.join("|"),
  },
  {
    name: "reset",
    description: "清空内存对话，从头开始",
  },
]

export interface NativeCommandResult {
  ok: boolean
  /** 展示行；宿主按自己的版式渲染 */
  lines: string[]
}

/** 菜单上限以外的模型只保留计数，避免刷屏 */
const MODEL_LIST_LIMIT = 12

function runModel(agent: PiAgent, rest: string): NativeCommandResult {
  const spec = rest.trim()
  if (spec === "") {
    const current = agent.modelSpec
    const all = agent.listModelSpecs()
    const shown = all.slice(0, MODEL_LIST_LIMIT).map((id) => (id === current ? `${id}  ← 当前` : id))
    if (all.length > MODEL_LIST_LIMIT) shown.push(`… 另有 ${all.length - MODEL_LIST_LIMIT} 个`)
    return { ok: true, lines: [`当前模型：${current ?? "?"}`, ...shown] }
  }
  if (/\s/.test(spec)) {
    return { ok: false, lines: ["用法：/model [provider/model]"] }
  }
  try {
    agent.setModelSpec(spec)
    return { ok: true, lines: [`模型已切换：${agent.modelSpec}（下一轮生效，对话保留）`] }
  } catch (err) {
    return { ok: false, lines: [`切换失败：${(err as Error).message}`] }
  }
}

function runEffort(agent: PiAgent, rest: string): NativeCommandResult {
  const level = rest.trim()
  if (level === "") {
    return { ok: true, lines: [`当前力度：${agent.effort ?? "模型默认"}`, `可选：${PI_EFFORTS.join("/")}`] }
  }
  if (!PI_EFFORTS.includes(level as PiEffort)) {
    return { ok: false, lines: [`未知力度 "${level}"；可选：${PI_EFFORTS.join("/")}`] }
  }
  agent.setEffort(level as PiEffort)
  return { ok: true, lines: [`力度已切换：${level}（下一轮生效）`] }
}

/**
 * 执行一条原生命令；name 不在命令表时返回 null（宿主继续走自己的分流）。
 * 未启动/未就绪按失败返回，不抛错——宿主把它当命令输出渲染。
 */
export function runNativeCommand(
  agent: PiAgent,
  name: string,
  rest: string,
): NativeCommandResult | null {
  if (!PI_NATIVE_COMMANDS.some((command) => command.name === name)) return null
  if (name === "model") return runModel(agent, rest)
  if (name === "effort") return runEffort(agent, rest)
  agent.resetConversation()
  return { ok: true, lines: ["内存对话已清空"] }
}
